import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { REPO, makeRepo, somi, writeFiles } from './helpers.mjs';

function startServer(t, dir) {
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'somi-mcp.mjs')], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, SOMI_GLOBAL_CONFIG: '', SOMI_CLOCK: '2026-01-02T00:00:00Z' }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const waiting = new Map();
  // A server that dies must fail the test, not leave it waiting for an answer.
  child.on('exit', () => { for (const resolve of waiting.values()) resolve({ error: { code: 'exited' } }); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
  });
  let id = 0;
  return (method, params) => new Promise((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

const call = async (rpc, name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return { error: r.result.isError === true, text: r.result.content[0].text };
};

test('five tools, which advise, record and never run project commands', async (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'somi.check.json': JSON.stringify({ fast_cmd: 'touch ran-marker' }), '.gitignore': '.somi\nran-marker\n' });
  const rpc = startServer(t, dir);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const { result } = await rpc('tools/list', {});
  assert.deepEqual(result.tools.map((x) => x.name), ['somi_route', 'somi_review', 'somi_note', 'somi_plan', 'somi_pr']);

  assert.equal(JSON.parse((await call(rpc, 'somi_route', { request: 'Add a helper' })).text).where, 'worker');
  assert.equal(JSON.parse((await call(rpc, 'somi_route', { request: 'Now fix the crash in the parser' })).text).route, 'debug', 'another request while work is under way is simply answered');

  writeFiles(dir, { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (c) => exec(c);\n' });
  const plan = JSON.parse((await call(rpc, 'somi_review', {})).text);
  assert.equal(plan.needed, true);
  assert.match(plan.advice, /fresh agent/);
  const reviews = [{ agent: 'somi-reviewer', verdict: 'approve', findings: [] }, { agent: 'somi-security-reviewer', verdict: 'approve', findings: [] }];
  assert.equal(JSON.parse((await call(rpc, 'somi_review', { reviews, tree: plan.tree })).text).verdict, 'clear');
  assert.equal(somi(dir, ['pr']).status, 0);
  const pr = JSON.parse((await call(rpc, 'somi_pr', {})).text);
  assert.equal(pr.reviewed, true);
  assert.match(pr.text, /somi-security-reviewer: approve/);
  assert.equal(JSON.parse((await call(rpc, 'somi_plan', { text: 'Milestone 1: a\nMilestone 2: b\n' })).text).total, 2);
  assert.equal(JSON.parse((await call(rpc, 'somi_plan', { done: 1 })).text).done, 1);
  assert.equal(JSON.parse((await call(rpc, 'somi_plan', { close: true })).text).closed, true);
  assert.equal(fs.existsSync(path.join(dir, 'ran-marker')), false, 'the MCP path runs outside the sandbox, so it never runs project commands');

  assert.equal(JSON.parse((await call(rpc, 'somi_note', { kind: 'decision', text: 'use postgres' })).text).added, true);
  assert.match((await call(rpc, 'somi_route', { request: 'Add a helper' })).text, /use postgres/);
});

test('a refused input is a tool error that names the reason, and an unknown tool is a protocol error', async (t) => {
  const dir = makeRepo(t);
  const rpc = startServer(t, dir);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  writeFiles(dir, { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (c) => exec(c);\n' });
  const r = await call(rpc, 'somi_review', { reviews: [{ agent: 'somi-reviewer', verdict: 'approve', findings: [] }] });
  assert.equal(r.error, true);
  assert.match(r.text, /no review from/);
  assert.equal((await call(rpc, 'somi_note', { kind: 'nope', text: 'x' })).error, true);
  assert.equal((await rpc('tools/call', { name: 'somi_step', arguments: {} })).error.code, -32602);
});

test('a field the model made up is named back to it instead of being read as an empty request', async (t) => {
  const dir = makeRepo(t);
  const rpc = startServer(t, dir);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const made = await call(rpc, 'somi_route', { description: 'Add password reset' });
  assert.equal(made.error, true);
  assert.match(made.text, /no field description/);
  assert.match(made.text, /request/);
  const none = await call(rpc, 'somi_route', {});
  assert.equal(none.error, true);
  assert.match(none.text, /needs request/);
  assert.equal((await call(rpc, 'somi_route', { hint: 'config' })).error, false);
  assert.match((await call(rpc, 'somi_review', { description: 'reviewed' })).text, /no field description/);
});

test('reviews sent as text are still read, and text that is not JSON is refused', async (t) => {
  const dir = makeRepo(t);
  const rpc = startServer(t, dir);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  writeFiles(dir, { 'src/app.js': 'export const one = 2;\n' });
  assert.equal(JSON.parse((await call(rpc, 'somi_review', { always: true, reviews: JSON.stringify([{ agent: 'somi-reviewer', verdict: 'approve', findings: [] }]) })).text).verdict, 'clear');
  assert.equal((await call(rpc, 'somi_review', { reviews: 'nope' })).error, true);
});
