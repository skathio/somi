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
import { runStep } from '../../../scripts/lib/loop-step.mjs';
import { LOG_MAX, stepLog } from '../../../scripts/lib/loop-step-kit.mjs';

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
// What the comparison keeps of a loop state: times and tree ids dropped, the step cursor ignored; `finished` only as set.
const norm = (r) => { const s = r.state(); return { st: s.status, fin: typeof s.finished, loop: s.loop, files: s.iteration_files, rm: s.review_min, co: s.cap_overrides, pass: s.pass, caps: s.caps, d: (s.dispatches ?? []).map(({ at, ...d }) => d), h: s.history.map(({ at, tree: t, ...h }) => h) }; };
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

console.log('== an internal error: exit 70, the fixed text and an empty stderr ==');
{
  // A state directory the step cannot create a file in, as root too: /proc/self (Linux).
  const FIXED = 'internal error: the step did not complete; retry it, and report it if it repeats';
  const r = repo();
  if (existsSync('/proc/self')) {
    const y = run(r, ['step', 'open', ...slug, '--files', 'a.js'], { SOMI_LOOP_STATE_DIR: '/proc/self' });
    check('a state file that cannot be saved is exit 70 with only the fixed response (no error name, path or stack) and nothing on stderr', [y.code, y.json?.exit, y.json?.error, y.err, /EACCES|ENOENT|stack|\.mjs|\/proc/.test(y.out)], [70, 70, FIXED, '', false]);
  }
  if (process.getuid?.() !== 0) { // chmod does not bind root: the log writes are covered below without it
    const q = repo(); prim(q, 'init', '--files', 'a.js'); chmodSync(q.sf, 0o444);
    const log = path.join(q.root, '.somi', 'somi-state', 'loop', 'step-errors.log'); const z = step(q, 'open', '--files', 'a.js');
    const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    check('the error is one JSON line in step-errors.log, naming the step and the error', [z.code, z.err, lines.length, JSON.parse(lines[0] ?? '{}').somi_loop_step, typeof JSON.parse(lines[0] ?? '{}').error], [70, '', 1, 'open', 'string']);
    chmodSync(q.sf, 0o644);
  }
}

console.log('== the error log: confined, capped, rotated ==');
{
  const home = () => { const root = path.join(tmp, `l${n++}`); mkdirSync(root); return { root, dir: path.join(root, '.somi', 'somi-state', 'loop') }; };
  const read = (f) => readFileSync(f, 'utf8');
  const h = home(); const w = stepLog(h.root, h.dir, false); w('{"a":1}'); w('{"b":2}');
  check('the log lives under the default state directory, one line per error', read(path.join(h.dir, 'step-errors.log')), '{"a":1}\n{"b":2}\n');

  const f = home(); mkdirSync(f.dir, { recursive: true }); execFileSync('mkfifo', [path.join(f.dir, 'step-errors.log')]);
  const hung = spawnSync(process.execPath, ['--input-type=module', '-e', `import { stepLog } from ${JSON.stringify(path.join(path.dirname(CLI), 'lib', 'loop-step-kit.mjs'))}; stepLog(${JSON.stringify(f.root)}, ${JSON.stringify(f.dir)}, false)('{"a":1}');`], { timeout: 5000, encoding: 'utf8' });
  check('a FIFO at the log path is left alone and does not hang the step', [hung.status, hung.signal, lstatSync(path.join(f.dir, 'step-errors.log')).isFIFO()], [0, null, true]);

  const l = home(); mkdirSync(l.dir, { recursive: true }); const away = path.join(tmp, `away${n}.txt`); writeFileSync(away, 'untouched'); symlinkSync(away, path.join(l.dir, 'step-errors.log'));
  stepLog(l.root, l.dir, false)('{"a":1}');
  check('a link at the log path is not followed', read(away), 'untouched');

  const p = home(); mkdirSync(path.join(p.root, '.somi'), { recursive: true }); const elsewhere = path.join(tmp, `elsewhere${n}`); mkdirSync(path.join(elsewhere, 'loop'), { recursive: true }); symlinkSync(elsewhere, path.join(p.root, '.somi', 'somi-state'));
  stepLog(p.root, p.dir, false)('{"a":1}');
  check('a link in the default state directory\'s path is not walked through: nothing is written behind it', readdirSync(path.join(elsewhere, 'loop')), []);

  const x = home(); const wx = stepLog(x.root, x.dir, true); const log = path.join(x.dir, 'step-errors.log');
  wx('{"old":1}'); writeFileSync(log, `${'x'.repeat(LOG_MAX - 20)}\n`); const target = path.join(tmp, `gen${n}.txt`); writeFileSync(target, 'untouched'); symlinkSync(target, `${log}.1`);
  wx(`{"new":"${'y'.repeat(40)}"}`);
  check('a line that would pass the cap moves the log to .1 (replacing a link there without following it) and starts a new log, which stays within the cap', [read(log).startsWith('{"new"'), read(`${log}.1`).startsWith('xxxx'), lstatSync(`${log}.1`).isSymbolicLink(), read(target), lstatSync(log).size <= LOG_MAX], [true, true, false, 'untouched', true]);

  const seen = []; const big = { get now() { const e = new Error('x'); e.name = 'N'.repeat(1000); e.stack = 'S'.repeat(100000); throw e; }, log: (line) => seen.push(line) };
  runStep(big, { step: 'open', slug: 'p1', iteration: '1.1', files: 'a.js' });
  const rec = JSON.parse(seen[0] ?? '{}');
  check('the stack and the error name are cut before the line is made, so the line is whole JSON within the cap', [seen.length, rec.stack?.length, rec.error?.length, Buffer.byteLength(seen[0] ?? '') < LOG_MAX / 8], [1, 4000, 100, true]);
}

console.log('== usage errors: the same JSON refusal on stdout, 64, stderr empty, nothing written ==');
{
  const r = repo(); const before = tree(r.root);
  const bad = [['an unknown flag', ['step', 'open', '--nope', '1']], ['a flag without a value', ['step', 'open', '--slug']], ['a repeated flag', ['step', 'open', '--slug', 'p1', '--slug', 'p1']], ['findings that are not JSON', ['step', 'after-review', '--slug', 'p1', '--findings', '[x']], ['a value in place of a flag', ['step', 'open', 'p1']]];
  check('each is refused 64 with the refusal on stdout (ok false, the step, the reason), one line, and an empty stderr', bad.map(([, argv]) => { const x = run(r, argv); return [x.code, x.json?.ok, x.json?.exit, x.json?.step, typeof x.json?.error, x.err, x.out.trim().split('\n').length]; }), bad.map(([, argv]) => [64, false, 64, argv[1], 'string', '', 1]));
  const esc = run(r, ['step', 'open', `--\u001b[31m${'z'.repeat(500)}`, '1']);
  check('the flag in the message is cut and cleaned: no control character, at most 40 characters of it', [esc.json?.error.includes('\u001b'), esc.json?.error.length < 120], [false, true]);
  const gen = run(r, ['pass', '--slug', 'p1', `--\u001b[31m${'z'.repeat(500)}`]);
  check('the same holds for the primitives\' usage error', [gen.code, gen.err.includes('\u001b'), gen.err.length < 120], [64, false, true]);
  check('an unknown step and a missing argument are refused inside the step: 64 and the field in the response', [step(r, 'nope').json?.exit, run(r, ['step', 'open', '--slug', 'p1', '--iteration', '1.1']).json?.error?.startsWith('files:')], [64, true]);
  check('nothing was written by any refusal', tree(r.root), before);
  check('the header comment lists exit 70 and the step subcommand', ['70 internal error', 'step <open|after-code|after-review|close|status>'].map((t) => readFileSync(CLI, 'utf8').includes(t)), [true, true]);
}
console.log(`loop step cli tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
