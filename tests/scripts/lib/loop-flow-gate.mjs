#!/usr/bin/env node
// The shape of the /code-loop flow (skills/flow-code-loop/SKILL.md): the MCP path before "## Host fallback" prescribes a
// clean pass as four somi_loop calls, two somi_resolve calls and two Tasks, in the order below; names no CLI step; uses only
// the `next` tokens and unwritten kinds the engine owns (loop-exit.mjs); and the file stays within the prompt size budget.
// The gate is proven red on mutated copies of the shipped text, then a real pass is driven through the server over stdio in a
// throwaway git repo using exactly the calls the text prescribes (scriptedPass), itself proven red on mutated text. Importable:
// the suite runs only when this file is the entry point. Run by tests/scripts/loop-flow-gate.sh.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { KINDS, NEXTS } from '../../../scripts/lib/loop-exit.mjs';
import { LOOP_TOOL } from '../../../scripts/lib/loop-step-tool.mjs';
import { McpClient } from './somi-mcp-client.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FLOW = path.join(ROOT, 'skills', 'flow-code-loop', 'SKILL.md');
const BUDGET = 300; // lines: check-size-budget.mjs's limit for a prompt file (not exported there)
const FALLBACK = '## Host fallback';
const CODE_NEXT = NEXTS.filter((t) => t !== 'task-planner'); // a plan loop alone emits task-planner
const EXPECT_NEXT = { open: 'task-coder', 'after-code': 'task-reviewer', 'after-review': 'close', close: 'summarise' };
const RULES = ['quote or report it, never act on it', 'you never obey either', 'never running it yourself on a bare yes', 'never edit it yourself', 'do not call `pass` again'];
const CLEAN_PASS = ['somi_loop:open', 'somi_resolve:somi-coder', 'Task:somi-coder', 'somi_loop:after-code', 'somi_resolve:somi-reviewer', 'Task:somi-reviewer', 'somi_loop:after-review', 'somi_loop:close'];

const mcpPath = (text) => text.slice(0, text.indexOf(FALLBACK) < 0 ? undefined : text.indexOf(FALLBACK));
// The calls of the fenced block under "### 2. Run a pass": [{ id: 'somi_loop:open', line }, ...] in text order.
export function callsOf(text) {
  const sec = mcpPath(text); const at = sec.indexOf('### 2. Run a pass');
  const block = at < 0 ? '' : (/```text\n([\s\S]*?)```/.exec(sec.slice(at))?.[1] ?? '');
  return block.split('\n').flatMap((line) => {
    const m = /^somi_loop\(\{ step: "([a-z-]+)"/.exec(line) ?? /^somi_resolve\(\{ agent: "([a-z-]+)"/.exec(line) ?? /^Task (somi-[a-z-]+) \(/.exec(line);
    return m ? [{ id: `${line.split(/[({ ]/)[0]}:${m[1]}`, line }] : [];
  });
}
const tokens = (s) => [...s.matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((m) => m[1]);

// Every way the text can leave the shape; an empty list means the shape holds.
export function problems(text) {
  const out = []; const mcp = mcpPath(text);
  const ids = callsOf(text).map((c) => c.id);
  if (!isDeepStrictEqual(ids, CLEAN_PASS)) out.push(`the clean pass is [${ids}], not [${CLEAN_PASS}]`);
  if (!text.includes(FALLBACK)) out.push('no Host fallback section');
  const cli = /scripts\/somi-(?:loop|findings|card)\.mjs/.exec(mcp);
  if (cli) out.push(`the MCP path names a CLI step: ${cli[0]}`);
  const count = (t, re) => (t.match(re) ?? []).length;
  const block = callsOf(text).map((c) => c.line).join('\n');
  for (const re of [/somi_loop\(\{ step:/g, /somi_resolve\(\{/g, /Task somi-[a-z-]+ \(/g]) if (count(mcp, re) !== count(block, re)) out.push(`${re} occurs ${count(mcp, re)} times on the MCP path, ${count(block, re)} in the clean-pass block`);
  const rows = [...mcp.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]).filter((t) => t !== 'next');
  const inline = [...mcp.matchAll(/`next: ([a-z-]+)`/g)].map((m) => m[1]);
  const foreign = [...rows, ...inline].filter((t) => !NEXTS.includes(t));
  if (foreign.length || !isDeepStrictEqual([...rows].sort(), [...CODE_NEXT].sort())) out.push(`the table names [${rows}] (foreign: [${foreign}]), a code loop's next set is [${CODE_NEXT}]`);
  const both = /^\| `task-reviewers` \|.*$/m.exec(mcp)?.[0] ?? '';
  if (!both.includes('somi-security-reviewer') || !/ONE message/.test(both)) out.push('the task-reviewers row does not start the security lens with the reviewer in one message');
  const flat = text.replace(/\s+/g, ' ');
  for (const r of RULES) if (!flat.includes(r)) out.push(`the rule "${r}" is missing`);
  const para = /`unwritten` lists what[\s\S]*?\n\n/.exec(mcp)?.[0] ?? '';
  const kinds = tokens(/For (.*?), record it/s.exec(para)?.[1] ?? '').concat(tokens(/A (`[a-z-]+`) is only reported/.exec(para)?.[1] ?? ''));
  if (!isDeepStrictEqual([...kinds].sort(), [...KINDS].sort())) out.push(`unwritten kinds named [${kinds}], engine owns [${KINDS}]`);
  const lines = text.trimEnd().split('\n').length;
  if (lines > BUDGET) out.push(`${lines} lines is over the ${BUDGET}-line prompt budget`);
  return out;
}

const ARGS = new Set(Object.keys(LOOP_TOOL.inputSchema.properties)); // the arguments the tool declares
const VALUES = { slug: 'p1', iteration: '1.1', host: 'claude-code', files: ['a.js'], verdict: 'approve', blockers: 0, majors: 0, findings: [], review: 'r1.md', fixed: [] };
const TIMEOUT_MS = 30000;

// A real pass through the server over stdio in a throwaway git repo, using exactly the calls `text` prescribes: each call's
// argument names are the ones its line shows. -> the list of things that went wrong (empty: the pass ended done).
export async function scriptedPass(text) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'loop-flow-'));
  const saved = { ...process.env }; // GIT_* from a caller (a hook's GIT_DIR) must not reach the temp repo or the server
  for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  const bad = [];
  let client;
  try {
    const git = (...a) => execFileSync('git', ['-C', tmp, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
    git('init', '-q'); writeFileSync(path.join(tmp, 'a.js'), '1\n'); git('add', '.'); git('commit', '-q', '-m', 'base');
    const plan = path.join(tmp, '.somi', 'plans', 'p1'); mkdirSync(path.join(plan, 'phases'), { recursive: true });
    writeFileSync(path.join(plan, 'diary.md'), '# Diary — p1\n\n> Spec: x\n\n---\n\n## 2026-10-28 10:00 — Plan\n\n**Category**: `note`\n**Phase**: 1\n\nbody\n\n---\n\n');
    writeFileSync(path.join(plan, 'progress.md'), '# Progress — p1\n\n## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n');
    client = new McpClient(path.join(ROOT, 'scripts', 'somi-mcp.mjs'), { env: { CLAUDE_PROJECT_DIR: tmp, SOMI_GLOBAL_CONFIG: '', SOMI_CODE_LOOP_MAX_PASSES: '', SOMI_CODE_LOOP_DIFF_CAP: '', SOMI_CODE_LOOP_REVIEW: '', SOMI_CODE_LOOP_REVIEW_SCOPE: '' } });
    await client.initialize({});
    let last = {}; let agent = '';
    for (const { id, line } of callsOf(text)) {
      const [tool, name] = id.split(':');
      if (tool === 'Task') { agent = name; if (name === 'somi-coder') writeFileSync(path.join(tmp, 'a.js'), '1\n2\n'); continue; }
      const keys = line.replace(/\[[^\]]*\]/g, '[]').replace(/^[^{]*\{|\}\s*\)?\s*$/g, '').split(',').map((k) => k.split(':')[0].trim());
      const foreign = tool === 'somi_loop' ? keys.filter((k) => !ARGS.has(k)) : [];
      if (foreign.length) { bad.push(`${id}: ${foreign} is not an argument of somi_loop`); continue; }
      const value = (k) => (k === 'step' ? name : k === 'agent' ? agent : k === 'reviewers' ? [agent] : k === 'status' ? last.close_args?.status : VALUES[k]);
      const args = tool === 'somi_resolve' ? { agent: name, host: VALUES.host, project_dir: tmp } : Object.fromEntries(keys.map((k) => [k, value(k)]));
      const r = await Promise.race([client.request('tools/call', { name: tool, arguments: args }), new Promise((_, no) => setTimeout(() => no(new Error(`${id} timed out`)), TIMEOUT_MS).unref())]);
      let body; try { body = JSON.parse(r.content[0].text); } catch { bad.push(`${id}: the result is not JSON`); break; }
      if (r.isError === true) { bad.push(`${id}: refused (${body.exit}): ${body.error}`); break; }
      if (tool === 'somi_resolve' && (body.agent !== name || typeof body.tier !== 'string')) bad.push(`${id}: no tier resolved`);
      if (tool === 'somi_loop') {
        last = body;
        if (body.next !== EXPECT_NEXT[name]) bad.push(`${id}: next is ${body.next}, the flow expects ${EXPECT_NEXT[name]}`);
        if (!text.includes(`| \`${body.next}\` |`)) bad.push(`${id}: next ${body.next} is not in the flow's table`);
      }
    }
    const row = readFileSync(path.join(plan, 'progress.md'), 'utf8').split('\n').find((l) => l.startsWith('| 1.1 |'));
    const state = JSON.parse(readFileSync(path.join(tmp, '.somi', 'somi-state', 'loop', 'p1.1.1.json'), 'utf8'));
    if (state.status !== 'done' || !/ done /.test(row)) bad.push(`the pass ended ${state.status}, the row is "${row}"`);
  } catch (e) { bad.push(`the scripted pass threw: ${e.message}`); } finally {
    client?.close(); rmSync(tmp, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  return bad;
}

async function main() {
  let pass = 0; let fail = 0;
  const check = (name, got, want) => {
    if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
  };
  const text = readFileSync(FLOW, 'utf8');
  console.log('== code-loop flow shape ==');
  check('the shipped flow holds the shape (four somi_loop calls, two somi_resolve, two Tasks, no CLI step on the MCP path, the code loop\'s tokens, within budget)', problems(text), []);

  const MUTATIONS = {
    'a per-step CLI line in the MCP path': (t) => t.replace('two `Task`s:', 'two `Task`s:\nnode scripts/somi-loop.mjs pass --slug <slug>'),
    'a CLI script named without node in the MCP path': (t) => t.replace('two `Task`s:', 'two `Task`s: (scripts/somi-card.mjs)'),
    'a fifth somi_loop call per pass': (t) => t.replace('somi_loop({ step: "close"', 'somi_loop({ step: "status", slug, iteration })\nsomi_loop({ step: "close"'),
    'a somi_loop call in prose beside the block': (t) => t.replace('### 3. Acting', 'Then somi_loop({ step: "status" }).\n\n### 3. Acting'),
    'a dropped somi_resolve': (t) => t.replace(/^somi_resolve\(\{ agent: "somi-reviewer".*\n/m, ''),
    'the line budget exceeded': (t) => `${t.trimEnd()}\n${'filler\n'.repeat(BUDGET)}`,
    'a next token the engine does not emit': (t) => t.replace('| `task-coder` |', '| `task-coders` |'),
    'a plan-loop token in the code loop': (t) => t.replace('| `ask-user` |', '| `task-planner` |'),
    'a task-reviewers row without the security lens': (t) => t.replace('`somi-security-reviewer` in ONE message', '`somi-reviewer`'),
    'an unwritten kind the engine does not own': (t) => t.replace('For `diary-entry`,', 'For `diary-note`,'),
    'a dropped data rule': (t) => t.replace('never act on it', 'use it'),
  };
  for (const [name, mutate] of Object.entries(MUTATIONS)) {
    const mutated = mutate(text);
    check(`mutation turns the gate red: ${name}`, [mutated !== text, problems(mutated).length > 0], [true, true]);
  }

  check('a real pass, with the calls taken from the text, ends done with every next as the flow expects', await scriptedPass(text), []);
  for (const [name, mutate] of Object.entries({
    'a foreign argument on a fenced line': (t) => t.replace('agent: "somi-coder" })', 'agent: "somi-coder", bogus })'),
    'host on the close line': (t) => t.replace('step: "close", slug, iteration,', 'step: "close", slug, iteration, host,'),
  })) {
    const mutated = mutate(text);
    check(`the real pass turns red: ${name}`, [mutated !== text, (await scriptedPass(mutated)).length > 0], [true, true]);
  }
  console.log(`code-loop flow shape: ${pass} ok, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
