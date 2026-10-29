#!/usr/bin/env node
// Tests of the composite loop step open (scripts/lib/loop-step.mjs), in throwaway git repos: validation, parity with
// the primitive subcommands, replay and kill-and-replay, tighten-only caps, write confinement, the size budget.
// Run by tests/scripts/loop-engine.sh.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { BUDGET, runStep } from '../../../scripts/lib/loop-step.mjs';
import { init, pass as passPrim, recordPass } from '../../../scripts/lib/loop-engine.mjs';
import { recordFindings } from '../../../scripts/lib/findings-ledger.mjs';
import { stateFile } from '../../../scripts/lib/loop-state.mjs';
import { markIteration, STATUSES } from '../../../scripts/lib/loop-notes.mjs';

const SOMI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'loop-step-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const NOW = '2026-10-29T09:30:00Z';
const ROWS = '## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n| 2.2 | two | not-started | — | — |\n';
const DIARY = '# Diary — p1\n\n> Spec: x\n\n---\n\n## 2026-10-28 10:00 — Plan\n\n**Category**: `note`\n**Phase**: 1\n\nbody\n\n---\n\n';
let n = 0;
// A repo with a.js and b.js committed and two plan directories (p1 for code loops, pl for plan loops).
function repo() {
  const root = path.join(tmp, `r${n++}`); mkdirSync(root);
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q'); writeFileSync(path.join(root, 'a.js'), '1\n'); writeFileSync(path.join(root, 'b.js'), '1\n'); git('add', 'a.js', 'b.js'); git('commit', '-q', '-m', 'base');
  for (const slug of ['p1', 'pl']) { mkdirSync(path.join(root, '.somi', 'plans', slug, 'phases'), { recursive: true }); writeFileSync(path.join(root, '.somi', 'plans', slug, 'diary.md'), DIARY); writeFileSync(path.join(root, '.somi', 'plans', slug, 'progress.md'), ROWS); }
  const ctx = (env = {}, o = {}) => ({ root, env: { SOMI_GLOBAL_CONFIG: '', ...env }, stateDir: path.join(root, '.somi', 'somi-state', 'loop'), installRoot: SOMI, now: () => NOW, via: 'mcp', ...o });
  return { root, ctx, diary: () => readFileSync(path.join(root, '.somi', 'plans', 'p1', 'diary.md'), 'utf8'), state: (slug = 'p1', it = '1.1') => JSON.parse(readFileSync(stateFile(ctx().stateDir, slug, it), 'utf8')), file: (f, text) => writeFileSync(path.join(root, f), text) };
}
const run = (r, args, env, o) => runStep(r.ctx(env, o), { slug: 'p1', iteration: '1.1', ...args });
const open = (r, args = {}, env, o) => run(r, { step: 'open', files: 'a.js', ...args }, env, o);
const entries = (r) => r.diary().split('\n').filter((l) => l.startsWith('## ')).length;
// Every file under the repo (the .git directory aside) with its hash: the "nothing was written" oracle.
const tree = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).filter((f) => !f.startsWith('.git')).sort().map((f) => [f, lstatSync(path.join(root, f)).isFile() ? createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex') : 'dir']));
const prim = { slug: 'p1', loop: 'code', iteration: '1.1', files: 'a.js', force: false, status: '', maxPasses: '', diffCap: '', severity: '', maxMinutes: '', verdict: '', blockers: '0', majors: '0', agent: '' };
const dies = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no throw'; };
const bytes = (r) => Buffer.byteLength(JSON.stringify(r));

console.log('== the engine reads no environment and no clock ==');
{
  const code = readFileSync(path.join(SOMI, 'scripts', 'lib', 'loop-step.mjs'), 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  check('loop-step.mjs names neither process, globalThis, Date.now nor new Date outside comments', /\b(process|globalThis)\b|Date\.now|new Date/.test(code), false);
  process.env.SOMI_CODE_LOOP_MAX_PASSES = '9';
  const r = repo(); const o = open(r);
  delete process.env.SOMI_CODE_LOOP_MAX_PASSES;
  check('a sentinel in process.env is ignored; the env handed in counts (cap 5 from ctx.env)', [o.caps.max_passes, open(repo(), {}, { SOMI_CODE_LOOP_MAX_PASSES: '5' }).caps.max_passes], [3, 5]);
}
console.log('== validation: refused with 64 naming the field, before any path or write ==');
{
  const r = repo(); const before = tree(r.root);
  const cases = [
    ['slug', { step: 'open', slug: '../x' }], ['slug', { step: 'open', slug: 'a/b' }], ['iteration', { step: 'open', iteration: '../1.1' }], ['iteration', { step: 'open', iteration: '1.1/../x' }],
    ['iteration', { step: 'open', iteration: '1.1.1' }], ['iteration', { step: 'open', iteration: `1.${'9'.repeat(300)}` }], ...['/etc/x', '-rf', '~/x', 'a/../b', 'a\\b', '..'].map((f) => ['files', { step: 'open', files: [f] }]), ['iteration', { step: 'open', iteration: undefined }], ['iteration', { step: 'open', loop: 'plan', slug: 'pl' }],
    ['verdict', { step: 'open', verdict: 'approve' }], ['agent', { step: 'open', agent: 'somi-coder' }], ['review_mode', { step: 'open', review_mode: 'panel' }],
    ['diff_cap', { step: 'open', loop: 'plan', slug: 'pl', iteration: undefined, diff_cap: 5 }], ['loop', { step: 'open', loop: 'x' }],
    ['max_passes', { step: 'open', max_passes: '1,0' }], ['max_passes', { step: 'open', max_passes: -1 }], ['diff_cap', { step: 'open', diff_cap: 1.5 }], ['files', { step: 'open', files: ['a\n.js'] }],
    ['review_scope', { step: 'open', review_scope: 'x' }], ['host', { step: 'open', host: 'vim' }], ['step', { step: 'nope' }], ['step', { step: 'close' }], ['step', { step: 'after-review' }], ['step', { step: 'after-code' }], ['step', { step: 'status' }],
  ];
  const got = cases.map(([f, a]) => { const x = runStep(r.ctx(), { slug: 'p1', iteration: '1.1', ...a }); return [x.exit, x.error.startsWith(`${f}:`)]; });
  check('every bad slug, iteration, foreign field, enum and cap shape exits 64 and names its field', got, cases.map(() => [64, true]));
  check('none of them wrote anything: the repo tree is byte-identical', tree(r.root), before);
  check('a missing files list is refused when a code loop starts, and open then creates no state file', [open(r, { files: undefined }).error, existsSync(path.join(r.root, '.somi', 'somi-state'))], ['files: required to start a code loop', false]);
  const bo = repo(); mkdirSync(path.join(bo.root, '.somi', 'plans', 'bo')); bo.file('.somi/plans/bo/progress.md', ROWS);
  const briefOnly = runStep(bo.ctx(), { step: 'open', slug: 'bo', iteration: '1.1', files: 'a.js' });
  check('a brief-only slug without the tier record is refused 64 and no state file appears', [briefOnly.exit, briefOnly.error.includes('brief-only'), existsSync(path.join(bo.root, '.somi', 'somi-state', 'loop', 'bo.1.1.json'))], [64, true, false]);
}
console.log('== open ==');
{
  const r = repo();
  const o = open(r);
  const s = r.state();
  check('open on a fresh slug starts the loop at pass 1 and asks for the coder; the brief is the card verbatim', [o.ok, o.exit, o.pass, o.next, o.stop_reason, o.replayed, o.brief.startsWith('```somi-card\n'), o.brief.includes('files in scope: a.js')], [true, 0, 1, 'task-coder', null, false, true, true]);
  check('the state holds pass 1, no history, and the cursor with its via, stored time and sub-steps', [s.pass, s.history, s.steps['1:open'].via, s.steps['1:open'].at, s.steps['1:open'].done], [1, [], 'mcp', NOW, ['pass', 'diary']]);
  check('the diary gained exactly one started entry, built from stored state, and the response lists the write', [entries(r), r.diary().includes('— code-loop started for iteration 1.1\n'), r.diary().includes('max_passes 3, diff_cap_lines 400, severity_floor Major; files: a.js'), o.wrote], [2, true, true, ['.somi/plans/p1/diary.md']]);
  const again = open(r);
  check('open twice returns the same pass with replayed: true, history unchanged, still one diary entry', [again.pass, again.replayed, again.brief, r.state().history, entries(r)], [1, true, o.brief, [], 2]);
  const lost = r.state(); delete lost.steps['1:open'].response; lost.steps['1:open'].done = ['pass'];
  writeFileSync(stateFile(r.ctx().stateDir, 'p1', '1.1'), JSON.stringify(lost));
  const redo = open(r);
  check('a retry that lost its marker after the writer ran re-sends a byte-identical entry and the writer drops it: one entry', [redo.replayed, redo.pass, entries(r)], [false, 1, 2]);
  const dc = repo(); init(dc.ctx(), prim); const sfd = stateFile(dc.ctx().stateDir, 'p1', '1.1');
  const hold = (text) => { rmSync(sfd, { force: true }); if (text) writeFileSync(sfd, text); else symlinkSync('gone', sfd);
    const t = tree(dc.root); const x = open(dc); return [x.exit, x.stop_reason, x.next, isDeepStrictEqual(tree(dc.root), t), /CLI/.test(x.error) && !/node |scripts\/|--/.test(x.error)]; };
  check('open refuses a finished or a corrupt state (64, ask-user, no command line in the text) or a dangling link and the tree, state file included, is byte-identical', [hold(JSON.stringify({ ...dc.state(), status: 'approved' })), hold('{ not json'), hold()], [[64, 'no-running-loop', 'ask-user', true, true], [64, 'no-running-loop', 'ask-user', true, true], [64, 'no-running-loop', 'ask-user', true, true]]);
  const gr = repo(); open(gr, { iteration: '2.2', max_passes: 1 }); recordPass(gr.ctx(), { ...prim, iteration: '2.2', verdict: 'needs-changes', blockers: '0', majors: '1' }); const gb = tree(gr.root); const nope = (a) => { const x = runStep(gr.ctx(), { step: 'open', slug: 'p1', iteration: '2.2', files: 'a.js', ...a }); return [x.exit, x.stop_reason]; };
  check('after 2.2 hit its cap, open for an undeclared 2.2c, a non-canonical 2.02 or 02.2, and an unplanned slug each refuse and the tree is byte-identical', [[nope({ iteration: '2.2c' }), nope({ iteration: '2.02' }), nope({ iteration: '02.2' }), nope({ slug: 'zz' })], tree(gr.root)], [[[64, 'not-declared'], [64, null], [64, null], [64, 'not-declared']], gb]);
  gr.file('.somi/plans/p1/progress.md', `${ROWS}| 2.2c | split | not-started | — | — |\n`);
  check('a declared 2.2c row lets the split start a fresh state (the legitimate path)', [nope({ iteration: '2.2c' })[0], existsSync(stateFile(gr.ctx().stateDir, 'p1', '2.2c'))], [0, true]);
  const big = repo(); const bb = tree(big.root); const huge = Array.from({ length: 20 }, (_, i) => `${i}${'x'.repeat(150)}.js`);
  check('an oversized files list is refused before init writes anything, and a corrected retry then starts', [open(big, { files: huge }).exit, tree(big.root), open(big).ok], [64, bb, true]);
  const planOpen = runStep(r.ctx(), { step: 'open', slug: 'pl', loop: 'plan' });
  check('a plan loop has no card and no diff cap and asks for the planner', [planOpen.next, planOpen.brief, planOpen.caps.diff_cap_lines, planOpen.pass], ['task-planner', '', 0, 1]);
}
{
  const r = repo();
  init(r.ctx(), prim); passPrim(r.ctx(), prim);
  check('open on a state the CLI pass primitive left at pass 1 returns pass 1, not 2', [open(r).pass, r.state().pass], [1, 1]);
  recordPass(r.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
  check('once the pass is recorded the next open counts pass 2 (and resumes: no after-review cursor, so a resumed entry)', [open(r).pass, r.diary().includes('— code-loop resumed at pass 2\n')], [2, true]);
}
{
  const r = repo(); open(r, { max_passes: 1 });
  recordPass(r.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
  const s = r.state();
  const x = open(r);
  check('max_passes 1 at start is accepted and recorded as a tool override; pass 2 is then max-passes-exceeded (exit 2) with the CLI command to re-run', [s.caps.max_passes, s.cap_overrides.map((c) => [c.field, c.from, c.to, c.source]), x.ok, x.exit, x.stop_reason, x.next, x.cli, r.state().pass], [1, [['max_passes', 3, 1, 'tool']], false, 2, 'max-passes-exceeded', 'close', 'node scripts/somi-loop.mjs pass --slug p1 --iteration 1.1 --max-passes <N>', 1]);
  const t = repo(); open(t);
  mkdirSync(path.join(t.root, '.somi', 'somi-state', 'run'), { recursive: true });
  writeFileSync(path.join(t.root, '.somi', 'somi-state', 'run', 'p1.json'), JSON.stringify({ started: '2026-10-29T08:00:00Z', max_minutes: 5 }));
  recordPass(t.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
  const late = open(t);
  check('a spent run budget stops at open with exit 4, judged on the injected clock, and counts no pass', [late.exit, late.stop_reason, late.next, late.pass, t.state().pass], [4, 'time-budget', 'close', 1, 1]);
}
console.log('== tighten-only caps ==');
{
  const r = repo(); open(r);
  const before = [readFileSync(stateFile(r.ctx().stateDir, 'p1', '1.1'), 'utf8'), tree(r.root)];
  const up = [open(r, { max_passes: 9 }), open(r, { diff_cap: 999 }), open(r, { diff_cap: 0 })];
  check('max_passes 9 against a stored 3, diff_cap 999 against 400 and diff_cap 0 (off) against 400 are refused 64 and the state file and tree are byte-identical', [up.map((x) => [x.exit, x.error.split(':')[0]]), [readFileSync(stateFile(r.ctx().stateDir, 'p1', '1.1'), 'utf8'), tree(r.root)]], [[[64, 'max_passes'], [64, 'diff_cap'], [64, 'diff_cap']], before]);
  const fresh = repo(); const fb = tree(fresh.root);
  check('a cap argument above what init would resolve is refused before init writes a state file', [open(fresh, { max_passes: 4 }).exit, tree(fresh.root)], [64, fb]);
  const low = repo(); const l = open(low, { diff_cap: 1 });
  check('diff_cap below the cap in force is applied at start and recorded with source tool', [l.exit, low.state().caps.diff_cap_lines, low.state().cap_overrides.map((c) => [c.field, c.from, c.to, c.source, c.after_pass])], [0, 1, [['diff_cap_lines', 400, 1, 'tool', 0]]]);
  check('a later call that tries to loosen it again is refused', open(low, { diff_cap: 2 }).exit, 64);
}
console.log('== kill and replay ==');
{
  const o = repo();
  const k1 = dies(() => open(o, {}, {}, { failAfter: 'pass' })); const k2 = dies(() => open(o, {}, {}, { failAfter: 'diary' }));
  const done = open(o);
  const w = repo(); rmSync(path.join(w.root, '.somi', 'plans', 'p1', 'diary.md')); dies(() => open(w, {}, {}, { failAfter: 'diary' }));
  check('a step killed after a diary that could not be written reports the unwritten item when retried', open(w).unwritten.map((u) => [u.file, u.reason]), [['diary.md', 'missing']]);
  check('open killed after pass, then after diary, then replayed: pass 1, no history, one diary entry', [k1, k2, done.pass, done.ok, o.state().history, entries(o)], ['failAfter pass', 'failAfter diary', 1, true, [], 2]);
}
console.log('== writers: their unwritten lines surface and never crash a step ==');
{
  const r = repo(); rmSync(path.join(r.root, '.somi', 'plans', 'p1', 'diary.md'));
  const o = open(r);
  check('a diary that is missing leaves the step complete with the entry text in unwritten', [o.ok, o.pass, o.wrote, o.unwritten.map((u) => [u.file, u.reason, u.line.includes('code-loop started')])], [true, 1, [], [['diary.md', 'missing', true]]]);
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const w = repo(); chmodSync(path.join(w.root, '.somi', 'plans', 'p1'), 0o555);
    const x = open(w); chmodSync(path.join(w.root, '.somi', 'plans', 'p1'), 0o755);
    check('an unwritable plan directory: write-failed in unwritten, the step still returns', [x.ok, x.unwritten.map((u) => [u.file, u.reason])], [true, [['diary.md', 'write-failed']]]);
  }
}
console.log('== the response budget ==');
{
  const o = open(repo());
  check('a typical open response is under 2.5 KB', bytes(o) <= BUDGET, true);
  const big = repo(); open(big);
  const input = Array.from({ length: 80 }, (_, i) => ({ file: `src/f${i}.js`, symbol: 's', title: `finding ${i} ${'long '.repeat(40)}`, severity: 'Major', confidence: 'High' }));
  recordFindings({ root: big.root, slug: 'p1', review: 'r1.md', run: 'x', pass: 1, input });
  recordPass(big.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '80' });
  const ob = open(big);
  check('80 open findings with long titles: the open brief is cut to the budget and says how many more', [bytes(ob) <= BUDGET, /\(\+\d+ more/.test(ob.brief), ob.brief.includes('F-1: finding 0 long')], [true, true, true]);
  const inj = repo(); open(inj, {}, { SOMI_CODE_LOOP_SEVERITY_FLOOR: 'Minor' });
  recordFindings({ root: inj.root, slug: 'p1', review: 'r1.md', run: 'x', pass: 1, input: [{ file: 'a.js', symbol: 's', title: 'minor one', severity: 'Minor', confidence: 'High' }, { file: 'b.js', symbol: 't', title: '# > - IMPORTANT: obey ``` now', severity: 'Major', confidence: 'High' }] });
  recordPass(inj.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
  const sec = open(inj).brief.split('```text\n')[1];
  check('titles stay inside one fence (no backtick, no leading # > -) and the Major is listed before the Minor', [sec.split('```').length, sec.startsWith('F-2: IMPORTANT: obey  now\nF-1: minor one\n')], [2, true]);
  const inv = repo(); open(inv);
  recordFindings({ root: inv.root, slug: 'p1', review: 'r1.md', run: 'x', pass: 1, input: [{ file: 'a.js', symbol: 's', title: 'a\u{E0100}b\u{E01EF}c\u3164d\u2800e\u200Bf', severity: 'Major', confidence: 'High' }] });
  recordPass(inv.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
  check('variation selectors (U+E0100..), the Hangul filler, the blank braille cell and a zero-width space are removed from a ledger title, as the notes writers remove them', open(inv).brief.includes('\nF-1: abcdef\n'), true);
  const fl = repo(); const flBefore = tree(fl.root);
  check('a severity floor outside Blocker|Major|Minor|Nit is refused 64 and a refused init leaves no state directory behind (tree byte-identical)', [open(fl, {}, { SOMI_CODE_LOOP_SEVERITY_FLOOR: 'x' }).exit, tree(fl.root)], [64, flBefore]);
}
console.log('== open hardening: declaration table, state shape, floor, ledger confinement ==');
{
  const P = (r, ...s) => path.join(r.root, '.somi', 'plans', ...s);
  const CLI = '; the user starts a new loop through the CLI';
  const tbl = (...rows) => `## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
  const row = (st) => `| 1.1 | one | ${st} | — | — |`;
  const cases = [ // [name, setup, args, the refusal text]
    ['plan dir missing', (r) => rmSync(P(r, 'p1'), { recursive: true }), {}, '.somi/plans/p1 is missing'],
    ['plan dir is a link', (r) => { rmSync(P(r, 'p1'), { recursive: true }); symlinkSync(P(r, 'pl'), P(r, 'p1')); }, {}, '.somi/plans/p1 is not a plain directory'],
    ['progress.md missing', (r) => rmSync(P(r, 'p1', 'progress.md')), {}, 'progress.md is missing'],
    ['progress.md is a link', (r) => { renameSync(P(r, 'p1', 'progress.md'), P(r, 'p1', 'real.md')); symlinkSync('real.md', P(r, 'p1', 'progress.md')); }, {}, 'progress.md is symlink'],
    ['progress.md is a directory', (r) => { rmSync(P(r, 'p1', 'progress.md')); mkdirSync(P(r, 'p1', 'progress.md')); }, {}, 'progress.md is not-a-regular-file'],
    ['progress.md over 4 MiB', (r) => r.file('.somi/plans/p1/progress.md', `${tbl(row('not-started'))}${' '.repeat((1 << 22) + 1)}`), {}, 'progress.md is too-large'],
    ['row outside any table', (r) => r.file('.somi/plans/p1/progress.md', `## Notes\n\n${row('not-started')}\n`), {}, 'the Iteration progress table of progress.md is not in the template shape'],
    ['row under another heading', (r) => r.file('.somi/plans/p1/progress.md', `${tbl('| 2.2 | two | not-started | — | — |')}\n## Other\n\n${row('not-started')}\n`), {}, 'iteration 1.1 has no row in the Iteration progress table of progress.md'],
    ['row with four cells', (r) => r.file('.somi/plans/p1/progress.md', tbl('| 1.1 | one | not-started | — |')), {}, 'the row of iteration 1.1 in progress.md is not in the template shape'],
    ['duplicate rows', (r) => r.file('.somi/plans/p1/progress.md', tbl(row('not-started'), row('not-started'))), {}, 'iteration 1.1 has more than one row in the Iteration progress table of progress.md'],
    ['table without the template header', (r) => r.file('.somi/plans/p1/progress.md', `## Iteration progress\n\n${row('not-started')}\n`), {}, 'the Iteration progress table of progress.md is not in the template shape'],
    ['empty progress.md', (r) => r.file('.somi/plans/p1/progress.md', ''), {}, 'progress.md is empty'],
    ['row marked done', (r) => r.file('.somi/plans/p1/progress.md', tbl(row('done'))), {}, 'iteration 1.1 is marked done in progress.md'],
    ['row marked superseded', (r) => r.file('.somi/plans/p1/progress.md', tbl(row('superseded'))), {}, 'iteration 1.1 is marked superseded in progress.md'],
    ['plan loop with none of spec.md, progress.md, brief.md', (r) => rmSync(P(r, 'pl', 'progress.md')), { slug: 'pl', loop: 'plan', iteration: undefined, files: undefined }, 'the plan directory has none of spec.md, progress.md or brief.md'],
    ['plan loop whose spec.md is a link', (r) => { rmSync(P(r, 'pl', 'progress.md')); symlinkSync(P(r, 'p1', 'diary.md'), P(r, 'pl', 'spec.md')); }, { slug: 'pl', loop: 'plan', iteration: undefined, files: undefined }, 'the plan directory has none of spec.md, progress.md or brief.md'],
    ['plan loop whose brief.md is a link', (r) => { rmSync(P(r, 'pl', 'progress.md')); symlinkSync(P(r, 'p1', 'diary.md'), P(r, 'pl', 'brief.md')); }, { slug: 'pl', loop: 'plan', iteration: undefined, files: undefined }, 'the plan directory has none of spec.md, progress.md or brief.md'],
  ];
  const got = cases.map(([, setup, args]) => { const r = repo(); setup(r); const t = tree(r.root); const x = open(r, args); return [x.exit, x.stop_reason, x.next, x.error, isDeepStrictEqual(tree(r.root), t)]; });
  check('every way a new loop is undeclared or unconfined is refused 64 not-declared / ask-user with its own reason, and the tree is byte-identical', got, cases.map((c) => [64, 'not-declared', 'ask-user', c[3] + CLI, true]));
  const started = ['not-started', 'in-progress', 'blocked'].map((st) => { const r = repo(); r.file('.somi/plans/p1/progress.md', tbl(row(st))); return open(r).ok; });
  const specOnly = repo(); rmSync(P(specOnly, 'pl', 'progress.md')); specOnly.file('.somi/plans/pl/spec.md', '# spec\n');
  const briefOnly = repo(); rmSync(P(briefOnly, 'pl', 'progress.md')); rmSync(P(briefOnly, 'pl', 'diary.md')); briefOnly.file('.somi/plans/pl/brief.md', '# brief\n'); // what /design hands to /plan-loop: brief.md (with design.md, decisions.md, diary.md)
  briefOnly.file('.somi/plans/pl/design.md', '# design\n');
  check('a not-started, in-progress or blocked row starts a loop, and so does a plan loop with only a spec.md or only a brief.md (the /design handoff)', [started, runStep(specOnly.ctx(), { step: 'open', slug: 'pl', loop: 'plan' }).ok, runStep(briefOnly.ctx(), { step: 'open', slug: 'pl', loop: 'plan' }).ok], [[true, true, true], true, true]);
  const want = [['1.1', 'done', false], ['2.1', 'done       ', false], ['2.2', 'not-started', true], ['2.3', 'in-progress', true], ['2.4', 'blocked    ', true], ['3.1', '**not-started**', false], ['3.2', 'not-started | extra', false], ['4.1', 'superseded', false]]; // the shapes of the real file, padded, bold and trailing-column rows included
  const real = repo(); const body = want.map(([it, st]) => `| ${it}       | A title that is long enough to pad | ${st} | approve-with-comments (pass 2) | 2026-10-29 — x |`).join('\n');
  real.file('.somi/plans/p1/progress.md', `${tbl(body)}\n## Follow-ups identified\n\n- none\n`);
  check('a template-shaped progress.md (done, padded, bold and trailing-column rows): a row opens exactly when its Status cell is not-started, in-progress or blocked and it has five cells', want.map(([it]) => [it, open(real, { iteration: it }).ok]), want.map(([it,, ok]) => [it, ok]));
  const fixtures = [ // open and markIteration read the table through one parser and agree on every shape
    ['plain table', tbl(row('not-started')), true],
    ['fenced duplicate row', `${tbl(row('not-started'))}\n\`\`\`\n${row('not-started')}\n\`\`\`\n`, false],
    ['commented duplicate row', `${tbl(row('not-started'))}\n<!--\n${row('not-started')}\n-->\n`, false],
    ['headerless table', `## Iteration progress\n\n${row('not-started')}\n`, false],
    ['row in a second section', `${tbl()}\n## Other\n\n${row('not-started')}\n`, false],
    ['duplicate rows', tbl(row('not-started'), row('not-started')), false],
    ['legacy 3-column table', '## Iteration progress\n\n| Iteration | Status | Notes |\n|---|---|---|\n| 1.1 | not-started | x |\n', false],
    ['legacy 6-column table', '## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity | Notes |\n|---|---|---|---|---|---|\n| 1.1 | one | not-started | — | — | x |\n', false],
  ];
  check('the same eight progress.md shapes through open and through markIteration: both accept the plain table and both refuse the fenced, commented, headerless, second-section, duplicate and legacy ones', fixtures.map(([, text]) => { const r = repo(); r.file('.somi/plans/p1/progress.md', `# Progress — p1\n\n${text}`); return [open(r).ok, markIteration({ root: r.root, slug: 'p1' }, '1.1', { status: 'in-progress', now: NOW }).wrote.length > 0]; }), fixtures.map(([,, ok]) => [ok, ok]));
  const grid = (from, to) => { const r = repo(); r.file('.somi/plans/p1/progress.md', `# Progress — p1\n\n${tbl(row(from))}`); const before = tree(r.root); const x = markIteration({ root: r.root, slug: 'p1' }, '1.1', { status: to, now: NOW }); return [from, to, x.unwritten[0]?.reason ?? 'ok', x.unwritten.length ? isDeepStrictEqual(tree(r.root), before) : null]; };
  const moves = { 'not-started': ['in-progress'], 'in-progress': ['done', 'blocked'], blocked: ['in-progress'] };
  check('of the 25 Status moves only a same-status rewrite, not-started to in-progress, in-progress to done or blocked and blocked to in-progress are written; every move out of done or superseded, and setting superseded, is transition-refused with the tree byte-identical', STATUSES.flatMap((f) => STATUSES.map((t) => grid(f, t))), STATUSES.flatMap((f) => STATUSES.map((t) => (f === t || moves[f]?.includes(t) ? [f, t, 'ok', null] : [f, t, 'transition-refused', true]))));
  const cli = repo(); init(cli.ctx(), { ...prim, iteration: '9.9' });
  const resumed = open(cli, { iteration: '9.9' });
  check('a state the CLI init made for an iteration with no row is resumed by open (the declaration gates only a new state)', [resumed.ok, resumed.pass, resumed.stop_reason], [true, 1, null]);

  const shaped = repo(); open(shaped); const good = shaped.state(); const sfs = stateFile(shaped.ctx().stateDir, 'p1', '1.1');
  const broken = [{ pass: '1' }, { pass: -1 }, { history: null }, { history: {} }, { caps: null }, { caps: [] }, { caps: { ...good.caps, max_passes: '3' } }, { caps: { ...good.caps, diff_cap_lines: null } }, { iteration_files: 'a.js' }, { iteration_files: [1] }, { loop: 'weird' }, { steps: 'x' },
    ...[null, 'x', { via: 'mcp', at: NOW, done: 'pass' }, { via: 'mcp', at: NOW, done: ['bogus'] }, { via: 'mcp', at: 5, done: [] }, { via: 'mcp', at: NOW, done: [], response: [] }, { via: 'mcp', at: NOW, done: [], out: { wrote: 'x', unwritten: [] } },
      { via: 'mcp', at: NOW, done: ['pass', 'diary'], response: { ok: true, brief: 'x'.repeat(BUDGET) } }].map((e) => ({ steps: { '1:open': e } })), // entries, and a stored response over the budget
    { review_min: 'x' }, { review_min: {} }, { caps: { ...good.caps, max_passes: -1 } }];
  const shapes = broken.map((b) => { writeFileSync(sfs, JSON.stringify({ ...good, ...b })); const t = tree(shaped.root); let x; try { x = open(shaped); } catch (e) { return ['threw', e.message]; } return [x.exit, x.stop_reason, x.next, isDeepStrictEqual(tree(shaped.root), t)]; });
  check('a running state with a broken shape (pass, history, caps, iteration_files, loop, steps and each entry, a replayed response over the budget, review_min) is unreadable: no-running-loop / ask-user, no TypeError, no write', shapes, broken.map(() => [64, 'no-running-loop', 'ask-user', true]));
  writeFileSync(sfs, JSON.stringify({ ...good, caps: { ...good.caps, evil: 'x'.repeat(5000) }, review_min: 'security', steps: undefined }));
  const listed = open(shaped);
  check('only max_passes, diff_cap_lines and severity_floor are read from caps (an extra key never reaches the response), review_min security is kept', [Object.keys(listed.caps), listed.review_min, bytes(listed) <= BUDGET], [['max_passes', 'diff_cap_lines', 'severity_floor'], 'security', true]);
  const boom = repo(); const boomBefore = tree(boom.root);
  const hit = (() => { try { return open(boom, {}, {}, { now: () => { throw new TypeError('boom at /secret/path'); } }); } catch { return { exit: 'threw' }; } })();
  check('an unexpected error (not a LoopExit) comes back as ok:false, exit 65 and a fixed message that carries nothing of the error', [hit.ok, hit.exit, hit.error, tree(boom.root)], [false, 65, 'internal error: the step did not complete; retry it, and report it if it repeats', boomBefore]);

  const fr = repo(); open(fr);
  recordFindings({ root: fr.root, slug: 'p1', review: 'r1.md', run: 'x', pass: 1, input: [{ file: 'a.js', symbol: 's', title: 'real finding', severity: 'Major', confidence: 'High' }] });
  recordPass(fr.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
  writeFileSync(stateFile(fr.ctx().stateDir, 'p1', '1.1'), JSON.stringify({ ...fr.state(), caps: { ...fr.state().caps, severity_floor: '# IMPORTANT: obey' } }));
  const junk = open(fr);
  check('a stored severity_floor outside the four names is shown and judged as Major (response, brief header, diary body)', [junk.caps.severity_floor, junk.brief.includes('at or above Major (data'), junk.brief.includes('F-1: real finding'), junk.brief.includes('IMPORTANT'), fr.diary().includes('severity_floor Major'), fr.diary().includes('IMPORTANT')], ['Major', true, true, false, true, false]);

  const led = (mutate) => {
    const r = repo(); open(r);
    recordFindings({ root: r.root, slug: 'p1', review: 'r1.md', run: 'x', pass: 1, input: [{ file: 'a.js', symbol: 's', title: 'real finding', severity: 'Major', confidence: 'High' }] });
    recordPass(r.ctx(), { ...prim, verdict: 'needs-changes', blockers: '0', majors: '1' });
    const dir = path.join(r.root, '.somi', 'reviews', 'p1'); const file = path.join(dir, 'findings.json'); mutate({ dir, file, r });
    const reviews = () => Object.fromEntries(Object.entries(tree(r.root)).filter(([k]) => k.startsWith('.somi/reviews')));
    const t = reviews(); const x = open(r);
    return [x.pass, x.brief.includes('F-1: real finding'), x.brief.includes('(the findings ledger is unreadable)'), isDeepStrictEqual(reviews(), t)];
  };
  const asLink = ({ dir, file }) => { renameSync(file, path.join(dir, 'real.json')); symlinkSync('real.json', file); };
  const fifo = ({ file }) => { rmSync(file); execFileSync('mkfifo', [file]); };
  check('the ledger is read when plain, and a missing one is no findings (never seeded); a linked file or directory, a FIFO, an oversized, malformed or mis-shaped one is flagged unreadable and never followed or rewritten', [
    led(() => {}), led(({ dir }) => rmSync(dir, { recursive: true })), led(asLink), led(({ dir }) => { renameSync(dir, `${dir}x`); symlinkSync(`${dir}x`, dir); }), led(fifo),
    led(({ file }) => writeFileSync(file, ' '.repeat((1 << 22) + 1))), led(({ file }) => writeFileSync(file, '{ nope')), led(({ file }) => writeFileSync(file, '{"findings": 5}')),
  ], [[2, true, false, true], [2, false, false, true], [2, false, true, true], [2, false, true, true], [2, false, true, true], [2, false, true, true], [2, false, true, true], [2, false, true, true]]);
}

console.log(`loop step tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
