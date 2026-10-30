#!/usr/bin/env node
// The words a step response is built from (loop-exit.mjs: the gate exits and the `next` and `kind` tokens, pinned against
// docs/PLUGIN.md), the unwritten items a stored response may carry (loop-step-kit.mjs stateAt), and saveState not writing
// through a link. Run by tests/scripts/loop-engine.sh.

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { GATE_STOPS, KIND, KINDS, NEXT } from '../../../scripts/lib/loop-exit.mjs';
import { stateAt } from '../../../scripts/lib/loop-step-kit.mjs';
import { saveState } from '../../../scripts/lib/loop-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'loop-words-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const doc = readFileSync(path.join(ROOT, 'docs', 'PLUGIN.md'), 'utf8');
const listed = (word) => [...(new RegExp(`\`${word}\`(?: call)? is one of: ([^.]*)\\.`).exec(doc)?.[1] ?? '').matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
check('the gate exits, the next tokens and the kinds are frozen, and the gate exits are 2 to 5', [GATE_STOPS, [GATE_STOPS, NEXT, KIND, KINDS].map(Object.isFrozen)], [[2, 3, 4, 5], Array(4).fill(true)]);
check('PLUGIN.md lists exactly the next tokens and the kinds the engine owns, in order', [listed('next'), listed('kind')], [[...NEXT], [...KINDS]]);

const running = (unwritten) => ({ status: 'running', loop: 'code', pass: 1, caps: { max_passes: 3, diff_cap_lines: 400 }, baseline_sha: 'a'.repeat(40), history: [], iteration_files: [], steps: { '1:open': { done: [], at: 'x', out: { wrote: [], unwritten } } } });
const item = (kind) => ({ file: 'progress.md', reason: 'r', line: 'l', ...(kind === undefined ? {} : { kind }) });
const readable = (kind) => { const f = path.join(tmp, `s${Math.random()}.json`); writeFileSync(f, JSON.stringify(running([item(kind)]))); return stateAt(f) !== null; };
check('a stored item with a kind of the set, or with none (stored before kinds existed), is readable; any other kind makes the state unreadable', [...KINDS, undefined, 'bogus', '', 7].map(readable), [...KINDS.map(() => true), true, false, false, false]);

const outside = path.join(tmp, 'outside.json'); writeFileSync(outside, 'keep');
const link = path.join(tmp, 'state.json'); symlinkSync(outside, link);
const thrown = (fn) => { try { fn(); } catch (e) { return e.code ?? e.message; } return null; };
const plainFile = path.join(tmp, 'plain.json'); writeFileSync(plainFile, 'x'.repeat(50));
check('saveState refuses a link at the state file instead of writing through it (the file it pointed to is untouched) and rewrites a plain file whole', [thrown(() => saveState(link, { a: 1 })), readFileSync(outside, 'utf8'), thrown(() => saveState(plainFile, { a: 1 })), readFileSync(plainFile, 'utf8')], ['ELOOP', 'keep', null, '{"a":1}']);

console.log(`loop step words tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
