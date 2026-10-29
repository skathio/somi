#!/usr/bin/env node
// Tests of the CLI `step` subcommand of scripts/somi-loop.mjs, run as a process: the steps and the primitives share one
// state, each gate answers with its exit code and the response alone, and an internal error (70) leaves the stderr
// empty and goes to a log file under the state directory, not through a link.
// Run by tests/scripts/loop-engine.sh.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'somi-loop.mjs');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'loop-step-cli-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const ROWS = '# Progress — p1\n\n## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n\n**Last activity**: 2026-10-28 — seeded\n';
const DIARY = '# Diary — p1\n\n---\n\n## 2026-10-28 10:00 — Plan\n\n**Category**: `note`\n**Phase**: 1\n\nbody\n\n---\n\n';
const FINDING = JSON.stringify([{ file: 'f1.js', symbol: 's', title: 'finding 1 here', severity: 'Major', confidence: 'High' }]);
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SOMI_|CLAUDE_)/.test(k)));
let n = 0;
function repo() {
  const root = path.join(tmp, `r${n++}`); mkdirSync(root);
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q'); writeFileSync(path.join(root, 'a.js'), '1\n'); git('add', 'a.js'); git('commit', '-q', '-m', 'base');
  mkdirSync(path.join(root, '.somi', 'plans', 'p1', 'phases'), { recursive: true });
  writeFileSync(path.join(root, '.somi', 'plans', 'p1', 'diary.md'), DIARY); writeFileSync(path.join(root, '.somi', 'plans', 'p1', 'progress.md'), ROWS);
  const sf = path.join(root, '.somi', 'somi-state', 'loop', 'p1.1.1.json');
  return { root, sf, state: () => JSON.parse(readFileSync(sf, 'utf8')), file: (f, t) => writeFileSync(path.join(root, f), t) };
}
const run = (r, argv, env = {}) => { const x = spawnSync('node', [CLI, ...argv], { cwd: r.root, encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: r.root, SOMI_GLOBAL_CONFIG: '', ...env } }); return { code: x.status, out: x.stdout, err: x.stderr, json: (() => { try { return JSON.parse(x.stdout); } catch { return null; } })() }; };
const slug = ['--slug', 'p1', '--iteration', '1.1'];
const prim = (r, cmd, ...more) => run(r, [cmd, ...slug, ...more]);
const step = (r, name, ...more) => run(r, ['step', name, ...slug, ...more]);
const tree = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).filter((f) => !f.startsWith('.git')).sort().map((f) => [f, lstatSync(path.join(root, f)).isFile() ? createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex') : 'dir']));
// What the comparison keeps of a loop state: times and tree ids dropped, the step cursor ignored.
const norm = (r) => { const s = r.state(); return { st: s.status, pass: s.pass, caps: s.caps, d: (s.dispatches ?? []).map(({ at, ...d }) => d), h: s.history.map(({ at, tree: t, ...h }) => h) }; };
const EDIT = '1\n2\n3\n';
const REVIEW = ['--reviewers', 'somi-reviewer', '--verdict', 'approve', '--blockers', '0', '--majors', '0', '--review', 'r1.md'];

console.log('== the steps and the primitives share one state ==');
{
  const a = repo(); prim(a, 'init', '--files', 'a.js'); prim(a, 'pass'); prim(a, 'record-dispatch', '--agent', 'somi-coder'); a.file('a.js', EDIT);
  prim(a, 'check-diff'); prim(a, 'review-scope'); prim(a, 'record-dispatch', '--agent', 'somi-reviewer'); prim(a, 'record-pass', '--verdict', 'approve'); prim(a, 'finish', '--status', 'done');
  const b = repo(); prim(b, 'init', '--files', 'a.js'); const bo = step(b, 'open', '--files', 'a.js'); b.file('a.js', EDIT); const ba = step(b, 'after-code', '--agent', 'somi-coder');
  prim(b, 'record-dispatch', '--agent', 'somi-reviewer'); prim(b, 'record-pass', '--verdict', 'approve'); prim(b, 'finish', '--status', 'done');
  const c = repo(); const co = step(c, 'open', '--files', 'a.js'); c.file('a.js', EDIT); step(c, 'after-code', '--agent', 'somi-coder');
  prim(c, 'record-dispatch', '--agent', 'somi-reviewer'); prim(c, 'record-pass', '--verdict', 'approve'); prim(c, 'finish', '--status', 'done');
  const d = repo(); step(d, 'open', '--files', 'a.js'); d.file('a.js', EDIT); step(d, 'after-code', '--agent', 'somi-coder'); const dr = step(d, 'after-review', ...REVIEW); const dc = step(d, 'close', '--status', 'done');
  check('an init by the primitive, then open and after-code by the steps, then the primitives, ends in the state of a loop run by primitives alone', [norm(b), bo.code, ba.code], [norm(a), 0, 0]);
  check('the reverse (the step opens the loop, the primitives record and finish it) ends in the same state', [norm(c), co.code], [norm(a), 0]);
  check('all four steps run by the CLI, reviewers as a comma list, end in the same state, and each prints one JSON line', [norm(d), dr.code, dc.code, [bo, dr, dc].map((x) => x.out.trim().split('\n').length), dc.json.next], [norm(a), 0, 0, [1, 1, 1], 'summarise']);
  const e = repo(); step(e, 'open', '--files', 'a.js'); e.file('a.js', EDIT); step(e, 'after-code', '--agent', 'somi-coder'); step(e, 'after-review', ...REVIEW.map((v) => (v === 'somi-reviewer' ? 'somi-reviewer,somi-security-reviewer' : v)));
  check('--reviewers takes a comma-separated list, each reviewer dispatched', e.state().dispatches.map((x) => x.agent), ['somi-coder', 'somi-reviewer', 'somi-security-reviewer']);
}

console.log('== the gates exit with their codes and print the response alone ==');
{
  const two = repo(); prim(two, 'init', '--files', 'a.js', '--max-passes', '1'); prim(two, 'pass'); prim(two, 'record-pass', '--verdict', 'request-changes', '--majors', '1'); const x2 = step(two, 'open');
  const three = repo(); step(three, 'open', '--files', 'a.js', '--diff-cap', '1'); three.file('a.js', '1\n'.repeat(9)); const x3 = step(three, 'after-code', '--agent', 'somi-coder');
  const four = repo(); mkdirSync(path.join(four.root, '.somi', 'somi-state', 'run'), { recursive: true }); writeFileSync(path.join(four.root, '.somi', 'somi-state', 'run', 'p1.json'), JSON.stringify({ started: '2020-01-01T00:00:00.000Z', max_minutes: 1 })); const x4 = step(four, 'open', '--files', 'a.js');
  const five = repo(); const round = () => { step(five, 'open', '--files', 'a.js'); five.file('a.js', `${five.state().pass}\n`.repeat(3)); step(five, 'after-code', '--agent', 'somi-coder'); return step(five, 'after-review', '--reviewers', 'somi-reviewer', '--verdict', 'request-changes', '--blockers', '0', '--majors', '1', '--review', 'r1.md', '--findings', FINDING); };
  round(); const x5 = round();
  const shape = (x) => [x.code, x.json?.exit, x.json?.stop_reason, x.json?.next, x.json?.close_args?.status, x.err, x.out.trim().split('\n').length];
  check('max passes is exit 2 with the response on stdout and nothing on stderr', shape(x2), [2, 2, 'max-passes-exceeded', 'close', 'stopped-max-passes-exceeded', '', 1]);
  check('the diff cap is exit 3', shape(x3), [3, 3, 'diff-cap-exceeded', 'close', 'stopped-diff-cap-exceeded', '', 1]);
  check('a spent time budget is exit 4', shape(x4), [4, 4, 'time-budget', 'close', 'stopped-time-budget', '', 1]);
  check('the circuit breaker is exit 5', shape(x5), [5, 5, 'circuit-breaker', 'close', 'stopped-circuit-breaker', '', 1]);
}

console.log('== an internal error: exit 70, the fixed text, a log file and an empty stderr ==');
{
  const r = repo(); prim(r, 'init', '--files', 'a.js'); chmodSync(r.sf, 0o444); // a state file the step cannot save: not a usage error, an error the step did not foresee
  const log = path.join(r.root, '.somi', 'somi-state', 'loop', 'step-errors.log');
  const x = step(r, 'open', '--files', 'a.js');
  const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  check('exit 70 prints only the fixed response (no error name, path or stack) and nothing on stderr', [x.code, x.json?.exit, x.json?.error, x.err, /EACCES|stack|\.mjs|\/tmp/.test(x.out)], [70, 70, 'internal error: the step did not complete; retry it, and report it if it repeats', '', false]);
  check('the error is one JSON line in step-errors.log, naming the step and the error', [lines.length, JSON.parse(lines[0] ?? '{}').somi_loop_step, typeof JSON.parse(lines[0] ?? '{}').error], [1, 'open', 'string']);
  rmSync(log); const away = path.join(tmp, 'log-target.txt'); writeFileSync(away, 'untouched'); symlinkSync(away, log);
  const y = step(r, 'open', '--files', 'a.js');
  check('a log path that is a link is not followed: the target is untouched and the answer is the same', [readFileSync(away, 'utf8'), y.code, y.err, y.json?.error], ['untouched', 70, '', x.json.error]);
  rmSync(log); writeFileSync(log, 'x'.repeat(65536)); step(r, 'open', '--files', 'a.js');
  check('a log at its size limit does not grow', lstatSync(log).size, 65536);
  chmodSync(r.sf, 0o644);
}

console.log('== usage errors: 64 on stderr, nothing on stdout, nothing written ==');
{
  const r = repo(); const before = tree(r.root);
  const bad = [['an unknown flag', ['step', 'open', '--nope', '1']], ['a flag without a value', ['step', 'open', '--slug']], ['a repeated flag', ['step', 'open', '--slug', 'p1', '--slug', 'p1']], ['findings that are not JSON', ['step', 'after-review', '--slug', 'p1', '--findings', '[x']], ['a value in place of a flag', ['step', 'open', 'p1']]];
  check('each is refused 64 with a message on stderr and an empty stdout', bad.map(([, argv]) => { const x = run(r, argv); return [x.code, x.out, x.err.startsWith('somi-loop: ')]; }), bad.map(() => [64, '', true]));
  check('an unknown step and a missing argument are refused inside the step: 64 and the field in the response', [step(r, 'nope').json?.exit, run(r, ['step', 'open', '--slug', 'p1', '--iteration', '1.1']).json?.error?.startsWith('files:')], [64, true]);
  check('nothing was written by any refusal', tree(r.root), before);
  check('the header comment lists exit 70 and the step subcommand', ['70 internal error', 'step <open|after-code|after-review|close|status>'].map((t) => readFileSync(CLI, 'utf8').includes(t)), [true, true]);
}
console.log(`loop step cli tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
