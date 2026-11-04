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

const step = async (rpc, args) => {
  const r = await rpc('tools/call', { name: 'somi_step', arguments: args });
  return { error: r.result.isError === true, text: r.result.content[0].text };
};

test('one tool, moving the same state machine, and never running project commands', async (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'somi.check.json': JSON.stringify({ fast_cmd: 'touch ran-marker' }), '.gitignore': '.somi\nran-marker\n' });
  const rpc = startServer(t, dir);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const { result } = await rpc('tools/list', {});
  assert.deepEqual(result.tools.map((x) => x.name), ['somi_step']);

  assert.equal(JSON.parse((await step(rpc, { action: 'open', title: 'via mcp' })).text).next, 'code');
  writeFiles(dir, { 'src/app.js': 'export const one = 2;\n' });

  const refused = JSON.parse((await step(rpc, { action: 'after-code' })).text);
  assert.equal(refused.refused, 'check-required', 'the MCP path runs outside the sandbox, so it refuses rather than running the check');
  assert.equal(fs.existsSync(path.join(dir, 'ran-marker')), false);

  assert.equal(somi(dir, ['check']).status, 0);
  assert.equal(JSON.parse((await step(rpc, { action: 'after-code' })).text).next, 'close');
  assert.equal(somi(dir, ['commit', '--message=via mcp']).status, 0);
  assert.equal(JSON.parse((await step(rpc, { action: 'close' })).text).outcome, 'done');
  assert.equal(JSON.parse((await step(rpc, { action: 'status' })).text).next, 'open');
});

test('a refused transition is a tool error that names the reason', async (t) => {
  const dir = makeRepo(t);
  const rpc = startServer(t, dir);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const r = await step(rpc, { action: 'close' });
  assert.equal(r.error, true);
  assert.match(r.text, /no milestone is open/);
  assert.equal((await rpc('tools/call', { name: 'somi_skill', arguments: {} })).error.code, -32602);
});
