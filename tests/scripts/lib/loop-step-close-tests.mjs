#!/usr/bin/env node
// Tests of the composite step that ends a pass, `after-review` (scripts/lib/loop-step-review.mjs): parity with the
// primitives, the circuit breaker, kill and replay after each sub-step, the diff-gate tie, validation and confinement.
// Run by tests/scripts/loop-engine.sh.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { BUDGET, runStep } from '../../../scripts/lib/loop-step.mjs';
import { checkDiff, init, pass as passPrim, recordDispatch, recordPass, reviewScope } from '../../../scripts/lib/loop-engine.mjs';
import { recordFindings, resolveFinding } from '../../../scripts/lib/findings-ledger.mjs';
import { stateFile } from '../../../scripts/lib/loop-state.mjs';

const SOMI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'loop-step-review-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const NOW = '2026-10-29T09:30:00Z';
const ROWS = '# Progress — p1\n\n## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n';
const DIARY = '# Diary — p1\n\n---\n\n## 2026-10-28 10:00 — Plan\n\n**Category**: `note`\n**Phase**: 1\n\nbody\n\n---\n\n';
const prim = { slug: 'p1', loop: 'code', iteration: '1.1', files: 'a.js', force: false, status: '', maxPasses: '', diffCap: '', severity: '', maxMinutes: '', verdict: '', blockers: '0', majors: '0', agent: '' };
const F = (n, severity = 'Major') => ({ file: `f${n}.js`, symbol: 's', title: `finding ${n} here`, severity, confidence: 'High' });
let n = 0;
function repo() {
  const root = path.join(tmp, `r${n++}`); mkdirSync(root);
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q'); writeFileSync(path.join(root, 'a.js'), '1\n'); git('add', 'a.js'); git('commit', '-q', '-m', 'base');
  for (const slug of ['p1', 'pl']) { mkdirSync(path.join(root, '.somi', 'plans', slug, 'phases'), { recursive: true }); writeFileSync(path.join(root, '.somi', 'plans', slug, 'diary.md'), DIARY); writeFileSync(path.join(root, '.somi', 'plans', slug, 'progress.md'), ROWS); }
  const ctx = (env = {}, o = {}) => ({ root, env: { SOMI_GLOBAL_CONFIG: '', ...env }, stateDir: path.join(root, '.somi', 'somi-state', 'loop'), installRoot: SOMI, now: () => NOW, via: 'mcp', ...o });
  const sf = stateFile(ctx().stateDir, 'p1', '1.1');
  return { root, ctx, sf, state: () => JSON.parse(readFileSync(sf, 'utf8')), put: (fn) => writeFileSync(sf, JSON.stringify(fn(JSON.parse(readFileSync(sf, 'utf8'))))), file: (f, t) => writeFileSync(path.join(root, f), t),
    diary: () => readFileSync(path.join(root, '.somi', 'plans', 'p1', 'diary.md'), 'utf8'), ledger: () => JSON.parse(readFileSync(path.join(root, '.somi', 'reviews', 'p1', 'findings.json'), 'utf8')) };
}
const step = (r, name, args = {}, env, o) => runStep(r.ctx(env, o), { step: name, slug: 'p1', iteration: '1.1', ...args });
const open = (r, args = {}, env, o) => step(r, 'open', { files: 'a.js', ...args }, env, o);
const after = (r, args = {}) => step(r, 'after-code', { agent: 'somi-coder', ...args });
const review = (r, args = {}, env, o) => step(r, 'after-review', { reviewers: ['somi-reviewer'], verdict: 'approve', blockers: 0, majors: 0, review: 'r1.md', ...args }, env, o);
// A repo at an after-code that passed, with a.js changed by `lines` lines.
const gated = (lines = 3, env) => { const r = repo(); open(r, {}, env); r.file('a.js', '1\n'.repeat(lines)); after(r); return r; };
const bytes = (x) => Buffer.byteLength(JSON.stringify(x));
const tree = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).filter((f) => !f.startsWith('.git')).sort().map((f) => [f, lstatSync(path.join(root, f)).isFile() ? createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex') : 'dir']));
const entries = (r) => r.diary().split('\n').filter((l) => l.startsWith('## ')).length;
const dies = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no throw'; };
// What criterion 2 compares: the state's history, dispatches and caps with times and tree ids dropped, and the ledger with dates dropped.
const norm = (r) => { const s = r.state(); const l = (() => { try { return r.ledger(); } catch { return null; } })();
  return { pass: s.pass, caps: s.caps, co: s.cap_overrides, d: s.dispatches, h: s.history.map(({ at, tree: t, ...h }) => h), l: l && { ...l, findings: l.findings.map((f) => ({ ...f, seen: f.seen.map(({ date, ...x }) => x) })) } }; };
const DATE = () => '2026-10-29';

console.log('== parity with the primitives (criterion 2) ==');
{
  const a = repo(); const b = repo(); const bf = (over) => ({ ...prim, ...over });
  const run = (args) => ({ root: b.root, slug: 'p1', run: b.state().started, now: DATE, ...args });
  open(a); a.file('a.js', '1\n2\n3\n'); after(a);
  const clean = review(a);
  init(b.ctx(), prim); passPrim(b.ctx(), prim); b.file('a.js', '1\n2\n3\n'); recordDispatch(b.ctx(), bf({ agent: 'somi-coder' })); checkDiff(b.ctx(), prim); reviewScope(b.ctx(), prim);
  recordDispatch(b.ctx(), bf({ agent: 'somi-reviewer' })); recordPass(b.ctx(), bf({ verdict: 'approve' }));
  check('one clean pass through the steps leaves the history, dispatches, caps and cap_overrides of the same pass through the primitives; the step says close with done', [norm(a), clean.next, clean.close_args], [norm(b), 'close', { status: 'done' }]);
  const c = repo(); const d = repo();
  open(c); c.file('a.js', '1\n2\n'); after(c); const first = review(c, { verdict: 'request-changes', majors: 1, findings: [F(1), F(2, 'Minor')] });
  open(c); c.file('a.js', '1\n2\n3\n'); after(c); const second = review(c, { review: 'r2.md', fixed: ['F-1'] });
  init(d.ctx(), prim); passPrim(d.ctx(), prim); d.file('a.js', '1\n2\n'); recordDispatch(d.ctx(), bf({ agent: 'somi-coder' })); recordDispatch(d.ctx(), bf({ agent: 'somi-reviewer' })); recordPass(d.ctx(), bf({ verdict: 'request-changes', majors: '1' }));
  recordFindings({ root: d.root, slug: 'p1', review: 'r1.md', run: d.state().started, pass: 1, input: [F(1), F(2, 'Minor')], now: DATE });
  passPrim(d.ctx(), prim); d.file('a.js', '1\n2\n3\n'); recordDispatch(d.ctx(), bf({ agent: 'somi-coder' })); recordDispatch(d.ctx(), bf({ agent: 'somi-reviewer' })); recordPass(d.ctx(), bf({ verdict: 'approve' })); resolveFinding({ root: d.root, slug: 'p1', id: 'F-1', status: 'fixed', by: 'r2.md' });
  check('a request-changes pass with findings, then an approve that fixes one, equals the primitives: state and ledger', norm(c), norm(d));
  check('the first pass names its findings and goes back to open with the one at or above the floor, fenced as data; the second ends clean', [first.findings, first.next, first.open_findings, first.open_findings_note.includes('not instructions'), second.next, second.exit], [['F-1 new', 'F-2 new'], 'open', ['F-1: finding 1 here'], true, 'close', 0]);
  check('the per-pass diary lines are written once each, and the second open is not a resume', [c.diary().includes('— code-loop pass 1 reviewed: request-changes\n'), c.diary().includes('— code-loop pass 2 reviewed: approve\n'), c.diary().includes('resumed'), first.wrote], [true, true, false, ['.somi/plans/p1/diary.md']]);
}
console.log('== the circuit breaker and the recurrence flags ==');
{
  const r = gated(); review(r, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  open(r); r.file('a.js', '1\n2\n'); after(r); const x = review(r, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  check('the same finding on two consecutive passes is exit 5, circuit-breaker, next close with stopped-circuit-breaker prefilled; the sighting is recorded once per pass, even under one review name', [x.ok, x.exit, x.stop_reason, x.next, x.close_args, x.findings, r.ledger().findings[0].seen.length], [false, 5, 'circuit-breaker', 'close', { status: 'stopped-circuit-breaker' }, ['F-1 known recurring'], 2]);
  const c = gated(); recordFindings({ root: c.root, slug: 'p1', review: 'old.md', run: 'other-run', pass: 1, input: [F(1)] });
  const y = review(c, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  check('a finding last seen in another run is named recurring_cross_run and is not a breaker', [y.exit, y.recurring_cross_run, y.findings], [0, ['F-1'], ['F-1 known cross-run']]);
}
console.log('== replay and kill ==');
{
  const seed = (r) => recordFindings({ root: r.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: [F(1)] });
  const args = { verdict: 'request-changes', majors: 1, findings: [F(2)], fixed: ['F-1'] };
  const ref = gated(); seed(ref); const whole = review(ref, args);
  const shape = (r) => [r.state().history.length, r.state().dispatches.length, r.ledger().findings.map((f) => [f.id, f.status, f.seen.length]), entries(r)];
  const got = ['dispatch', 'record', 'findings', 'resolve', 'diary'].map((sub) => { const r = gated(); seed(r); const k = dies(() => review(r, args, {}, { failAfter: sub })); const done = review(r, args); return [k, done.ok, done.next, done.findings, shape(r)]; });
  check('after-review killed after each of its five sub-steps and retried leaves one history entry, one reviewer dispatch, one sighting and one diary line, as one uninterrupted call does', got, ['dispatch', 'record', 'findings', 'resolve', 'diary'].map((s) => [`failAfter ${s}`, true, whole.next, whole.findings, shape(ref)]));
  const k = gated(); seed(k); dies(() => review(k, args, {}, { failAfter: 'record' }));
  check('the status step lists the new sub-steps of an unfinished after-review', step(k, 'status').cursor.at(-1), { key: '1:after-review', via: 'mcp', done: ['dispatch', 'record'], complete: false });
  check('the after-review cursor holds the arguments\' signature and no copy of the review file name', Object.keys(ref.state().steps['1:after-review']).sort(), ['at', 'done', 'fixed', 'found', 'out', 'response', 'sig', 'via']);
  const again = review(ref, args);
  check('a finished after-review repeats as replayed with the same answer and writes nothing more', [again.replayed, again.next, again.findings, shape(ref)], [true, whole.next, whole.findings, shape(ref)]);
  const diff = review(ref, { ...args, review: 'r9.md' });
  check('a repeat with other arguments is refused 64 and changes nothing', [diff.exit, diff.error?.split(':')[0], shape(ref)], [64, 'arguments', shape(ref)]);
  const g = gated(); recordFindings({ root: g.root, slug: 'p1', review: 'r1.md', run: g.state().started, pass: 1, input: [F(1)] });
  review(g, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  check('a ledger write that landed before its mark (a crash between the two) is not counted again on retry: one sighting', g.ledger().findings[0].seen.length, 1);
}
console.log('== the diff gate is tied to the tree (an unmeasured tree is not gated) ==');
{
  const stale = gated(); stale.file('a.js', 'changed after the gate\n'); const before = [tree(stale.root), stale.state()];
  const x = review(stale);
  check('a working tree changed after the passing after-code is refused 64 naming after-code as the remedy, and nothing is written', [x.exit, x.error?.includes('call after-code'), tree(stale.root), stale.state()], [64, true, ...before]);
  const gone = gated(); gone.put((s) => { delete s.steps['1:after-code'].measured; return s; });
  const open1 = repo(); open(open1);
  check('a pass whose after-code stored no measured tree, or that had no after-code at all, is refused the same way', [review(gone).exit, review(open1).exit, review(open1).error?.includes('call after-code')], [64, 64, true]);
  const resumed = gated(); dies(() => review(resumed, {}, {}, { failAfter: 'record' })); resumed.file('a.js', 'x\n'.repeat(9));
  check('once the pass is recorded a resume is not blocked by a tree that moved since', review(resumed).ok, true);
  const p = repo(); runStep(p.ctx(), { step: 'open', slug: 'pl', loop: 'plan' }); runStep(p.ctx(), { step: 'after-code', slug: 'pl', loop: 'plan', agent: 'somi-planner' });
  const pr = runStep(p.ctx(), { step: 'after-review', slug: 'pl', loop: 'plan', reviewers: ['somi-reviewer'], verdict: 'approve', blockers: 0, majors: 0, review: 'r1.md' });
  check('a plan loop needs no gate: its after-review records the pass and says close', [pr.ok, pr.next, JSON.parse(readFileSync(stateFile(p.ctx().stateDir, 'pl', ''), 'utf8')).history.length], [true, 'close', 1]);
}
console.log('== what comes next, and the size of the answer ==');
{
  const r = gated(); recordFindings({ root: r.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: Array.from({ length: 300 }, (_, i) => F(i + 1)) });
  const x = review(r, { verdict: 'request-changes', majors: 100, findings: Array.from({ length: 100 }, (_, i) => F(i + 1)) });
  const more = Number(/^\(\+(\d+) more/.exec(x.open_findings?.at(-1))?.[1]);
  check('300 open findings and 100 recorded: the answer fits the budget, lists 12 of the 100 and counts the rest, and counts what the open list cuts', [bytes(x) <= BUDGET, x.findings.length, x.findings_total, x.open_findings.length - 1 + more], [true, 12, 100, 300]);
  const m = gated(); const y = review(m, { verdict: 'request-changes', findings: [F(1, 'Minor')] });
  check('a request-changes with nothing at or above the floor ends clean: close with done', [y.next, y.close_args], ['close', { status: 'done' }]);
  const u = gated(); const z = review(u, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  const v = gated(); recordFindings({ root: v.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: [F(1, 'Minor')] }); const w = review(v);
  check('a request-changes with an open Major goes back to open; an approve ends the loop whatever sits below the floor in the ledger', [z.next, z.close_args, w.next, w.close_args], ['open', undefined, 'close', { status: 'done' }]);
}
console.log('== arguments and confinement: refused 64 naming the field, nothing written ==');
{
  const r = gated(); const before = tree(r.root);
  const bad = [['reviewers', { reviewers: [] }], ['reviewers', { reviewers: ['a', 'b', 'c', 'd', 'e'] }], ['reviewers', { reviewers: ['../x'] }], ['verdict', { verdict: 'fine' }], ['review', { review: '../x' }], ['review', { review: 'a/b.md' }], ['review', { review: '..' }],
    ['blockers', { blockers: -1 }], ['majors', { majors: 'x' }], ['findings', { findings: [{ file: 'a.js' }] }], ['findings', { findings: [{ file: 'a.js', title: 't', severity: 'Huge' }] }], ['findings', { findings: [{ file: 'a\n.js', title: 't' }] }],
    ['findings', { findings: Array.from({ length: 101 }, () => F(1)) }], ['fixed', { fixed: ['F-1; rm'] }],
    ['blockers', { blockers: 3 }], ['majors', { majors: 1 }], ['findings', { findings: [{ file: 'a.js', title: 't' }] }], ['verdict', { majors: 1, findings: [F(1)] }], ['verdict', { verdict: 'approve-with-comments', blockers: 1, findings: [F(1, 'Blocker')] }],
    ['reviewers', { reviewers: ['somi-coder'] }], ['reviewers', { reviewers: ['somi-reviewer', 'somi-coder'] }], ['reviewers', { reviewers: ['no-such-agent'] }], ['reviewers', { reviewers: ['somi-reviewer', 'somi-reviewer'] }], ['findings', { findings: [{ ...F(1), title: 'a\u202eb' }] }], ['findings', { findings: [{ ...F(1), title: 'a\u2028b' }] }],
    ['fixed', { verdict: 'request-changes', majors: 1, findings: [F(1)], fixed: ['F-1'] }], ['fixed', { fixed: 'F-1' }], ['agent', { agent: 'somi-coder' }], ['diff_cap', { diff_cap: 1 }]];
  const got = bad.map(([f, a]) => { const x = review(r, a); return [x.exit, x.error?.startsWith(`${f}:`)]; });
  check('a bad reviewers list, verdict, review name, count, finding, fixed id or foreign field exits 64 naming its field', got, bad.map(() => [64, true]));
  check('none of these wrote anything: the tree is byte-identical and no cursor was made', [tree(r.root), Object.keys(r.state().steps)], [before, ['1:open', '1:after-code']]);
  const shapes = ['{"next_id":"x","findings":[]}', '{"next_id":1000000,"findings":[]}', '{"next_id":1,"findings":[{"id":"F-1","key":"k","status":"open","seen":[5]}]}', '{"next_id":1,"findings":[{"id":"F-1","key":"k","seen":[]}]}'];
  const shaped = shapes.map((json) => { const m = gated(); mkdirSync(path.join(m.root, '.somi', 'reviews', 'p1'), { recursive: true }); writeFileSync(path.join(m.root, '.somi', 'reviews', 'p1', 'findings.json'), json); const t = tree(m.root); const x = review(m, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
    return [x.exit, x.error?.includes('findings ledger'), isDeepStrictEqual(tree(m.root), t), Object.keys(m.state().steps).length]; });
  check('a ledger not in the shape the ledger functions assume (next_id, a sighting, a missing status) is refused 64 before any step is recorded', shaped, shapes.map(() => [64, true, true, 2]));
  for (const [name, link] of [['a symlinked reviews directory', 'reviews'], ['a symlinked findings.json', 'reviews/p1/findings.json']]) {
    const s = gated(); mkdirSync(path.join(s.root, 'elsewhere')); mkdirSync(path.join(s.root, '.somi', 'reviews', 'p1'), { recursive: true });
    if (link === 'reviews') { rmSync(path.join(s.root, '.somi', 'reviews'), { recursive: true }); symlinkSync(path.join(s.root, 'elsewhere'), path.join(s.root, '.somi', 'reviews')); } else symlinkSync(path.join(s.root, 'elsewhere', 'f.json'), path.join(s.root, '.somi', link));
    const t = tree(s.root); const x = review(s, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
    check(`${name} is refused 64 before anything is recorded, and nothing is written`, [x.exit, x.error?.includes('findings ledger'), tree(s.root)], [64, true, t]);
  }
}
console.log('== the pass\'s own checks: reviewer lens, fixed ids, the saved ledger, the signature ==');
{
  const lens = (env, rev, tweak = (r) => r) => { const r = repo(); open(r); r.file('a.js', '1\n2\n'); step(r, 'after-code', { agent: 'somi-coder' }, env); tweak(r); return review(r, { reviewers: rev }).exit; };
  const R = 'somi-reviewer'; const S = 'somi-security-reviewer'; const sec = { SOMI_CODE_LOOP_REVIEW: 'security' }; const pan = { SOMI_CODE_LOOP_REVIEW: 'panel' };
  check('the generalist is always required; security mode and a sizing record of security also need the security lens; a panel needs a second code-review lens', [lens({}, [S]), lens(sec, [R]), lens(sec, [R, S]), lens(pan, [R]), lens(pan, [R, 'somi-plan-reviewer']), lens(pan, [R, 'somi-architecture-reviewer']), lens({}, [R], (r) => r.put((s) => ({ ...s, review_min: 'security' }))), lens({}, [R, S], (r) => r.put((s) => ({ ...s, review_min: 'security' })))], [64, 64, 0, 64, 64, 0, 64, 0]);
  const p = repo(); runStep(p.ctx(), { step: 'open', slug: 'pl', loop: 'plan' }); runStep(p.ctx(), { step: 'after-code', slug: 'pl', loop: 'plan', agent: 'somi-planner' });
  const pr = (rev) => runStep(p.ctx(), { step: 'after-review', slug: 'pl', loop: 'plan', reviewers: rev, verdict: 'approve', blockers: 0, majors: 0, review: 'r1.md' }).exit;
  check('a plan loop needs its plan reviewer or the generalist', [pr(['somi-test-strategist']), pr(['somi-plan-reviewer'])], [64, 0]);
  const f = gated(); recordFindings({ root: f.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: [F(1), F(2), F(3, 'Blocker')] }); resolveFinding({ root: f.root, slug: 'p1', id: 'F-1', status: 'accepted', by: 'person' });
  const x = review(f, { verdict: 'request-changes', majors: 1, findings: [F(4)], fixed: ['F-1', 'F-2', 'F-3', 'F-3'], review: 'r2.md' });
  const st = Object.fromEntries(f.ledger().findings.map((y) => [y.id, [y.status, y.resolved_by]]));
  check('fixed resolves the open findings it names, as id and severity in the answer and the diary; a repeated id counts once, and a status a person set is skipped and unchanged', [x.exit, x.resolved, x.skipped, st['F-1'], st['F-2'], st['F-3'], f.diary().includes('fixed: F-2 Major, F-3 Blocker')], [0, ['F-2 Major', 'F-3 Blocker'], ['F-1'], ['accepted', 'person'], ['fixed', 'r2.md'], ['fixed', 'r2.md'], true]);
  const b = gated(); review(b, { verdict: 'request-changes', majors: 1, findings: [F(1)] }); open(b); b.file('a.js', '1\n2\n'); after(b);
  const trick = { verdict: 'request-changes', majors: 1, findings: [F(1)], fixed: ['F-1'] }; const t = tree(b.root);
  check('reporting a finding and fixing it in the same call is refused 64 and writes nothing, so the third pass of one finding reaches exit 5', [review(b, trick).exit, tree(b.root), review(b, { ...trick, fixed: [] }).exit], [64, t, 5]);
  const one = gated(); review(one, { verdict: 'request-changes', majors: 2, findings: [F(1), F(1)] });
  check('two findings of one locus in one call leave one finding with one sighting', one.ledger().findings.map((y) => y.seen.length), [1]);
  const sg = gated(); recordFindings({ root: sg.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: [F(8), F(9)] });
  const base = { reviewers: ['somi-reviewer', S], verdict: 'request-changes', majors: 2, findings: [F(1), F(2)], fixed: ['F-1', 'F-2'], review: 'r1.md' };
  review(sg, base); const flipped = { review: 'r1.md', findings: [{ title: F(2).title, file: 'f2.js', severity: 'Major', symbol: 's', confidence: 'High' }, { severity: 'Major', file: 'f1.js', symbol: 's', title: F(1).title, confidence: 'High' }], majors: 2, blockers: 0, verdict: 'request-changes', fixed: ['F-2', 'F-1'], reviewers: [S, 'somi-reviewer'] };
  const rp = runStep(sg.ctx(), { step: 'after-review', slug: 'p1', iteration: '1.1', ...flipped });
  check('a retry with its keys and lists in another order is the same call: replayed, not refused', [rp.replayed, rp.exit], [true, 0]);
  const v = gated(); const away = path.join(tmp, 'victim.txt'); mkdirSync(path.join(v.root, '.somi', 'reviews', 'p1'), { recursive: true }); writeFileSync(away, 'untouched'); symlinkSync(away, path.join(v.root, '.somi', 'reviews', 'p1', 'findings.json.tmp'));
  const w = review(v, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  check('a link planted at the ledger\'s old temp name is not followed: its target is untouched and the finding is recorded', [w.exit, readFileSync(away, 'utf8'), v.ledger().findings.length], [0, 'untouched', 1]);
  const nope = review(gated(), { fixed: ['F-9'] });
  check('a fixed id that is not in the ledger is refused 64 and says so', [nope.exit, nope.error?.includes('not in the findings ledger')], [64, true]);
  const rs = (by) => { const q = gated(); recordFindings({ root: q.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: [F(1)] }); resolveFinding({ root: q.root, slug: 'p1', id: 'F-1', status: 'fixed', by }); return review(q, { verdict: 'request-changes', majors: 1, findings: [F(2)], fixed: ['F-1'] }); };
  check('a finding this same review already fixed (a retry after the write landed) is reported resolved; one fixed by another review is skipped', [rs('r1.md').resolved, rs('r0.md').skipped], [['F-1 Major'], ['F-1']]);
  const e = gated(); const next = (r, txt) => { r.file('a.js', txt); open(r); after(r); };
  review(e, { verdict: 'request-changes', majors: 1, findings: [F(1), F(2, 'Minor')] }); next(e, '1\n2\n');
  review(e, { review: 'r2.md', verdict: 'request-changes', majors: 1, findings: [F(3)], fixed: ['F-1'] }); next(e, '1\n2\n3\n4\n');
  const up = review(e, { review: 'r3.md', verdict: 'request-changes', blockers: 1, findings: [{ ...F(2), severity: 'Blocker' }], fixed: ['F-3'] });
  check('a Minor finding listed again as a Blocker is raised to Blocker, and the loop does not close as done', [up.next, e.ledger().findings.find((y) => y.id === 'F-2').severity], ['open', 'Blocker']);
  const sa = gated(); review(sa, { verdict: 'request-changes', blockers: 1, findings: [F(1, 'Blocker')] }); next(sa, '1\n2\n');
  const stale = review(sa, { review: 'r2.md' }); const kept = tree(sa.root);
  check('an approve while an earlier Blocker is open and neither listed nor fixed is refused 64 naming it, and writes nothing; with the id in fixed it closes', [stale.exit, stale.error?.includes('F-1 Blocker') && stale.error.includes('accepted/wontfix'), isDeepStrictEqual(tree(sa.root), kept), review(sa, { review: 'r2.md', fixed: ['F-1'] }).next], [64, true, true, 'close']);
  const d = repo(); mkdirSync(path.join(d.root, '.somi', 'reviews', 'p1'), { recursive: true }); const made = path.join(tmp, 'made.json'); symlinkSync(made, path.join(d.root, '.somi', 'reviews', 'p1', 'findings.json'));
  check('the ledger is not seeded through a dangling link: the call fails and nothing is created at the link target', [dies(() => recordFindings({ root: d.root, slug: 'p1', review: 'r', run: 'x', pass: 1, input: [F(1)] })) !== 'no throw', existsSync(made)], [true, false]);
  const cf = gated(); writeFileSync(path.join(cf.root, '.somi', 'config.json'), '{ not json'); const cs = readFileSync(cf.sf, 'utf8'); const cx = review(cf);
  check('a dispatch the resolver refuses (a malformed config) is refused with its code and leaves the loop state byte-identical', [cx.exit, readFileSync(cf.sf, 'utf8') === cs], [67, true]);
  const sv = gated(); recordFindings({ root: sv.root, slug: 'p1', review: 'r0.md', run: sv.state().started, pass: 0, input: [F(1, 'high')] });
  const lst = review(sv, { verdict: 'request-changes', findings: [F(2, 'Minor')] }); sv.file('a.js', '1\n2\n'); open(sv); after(sv);
  const blocked = review(sv, { review: 'r2.md' }); const fixedU = review(sv, { review: 'r2.md', fixed: ['F-1'] });
  check('a finding with a severity outside the four names (as the CLI stores it) is listed in open_findings, blocks an approve, and fixing it leaves a readable state where the next open works', [lst.next, lst.open_findings, blocked.exit, blocked.error?.includes('F-1 Unrated'), fixedU.resolved, open(sv).exit], ['open', ['F-1: finding 1 here'], 64, true, ['F-1 Unrated'], 0]);
  const nb = repo(); recordFindings({ root: nb.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 0, input: [F(1, 'blocker'), F(2, 'weird')] });
  check('the ledger writer stores blocker as Blocker and any other severity as given', nb.ledger().findings.map((y) => y.severity), ['Blocker', 'weird']);
  const rn = gated(); recordFindings({ root: rn.root, slug: 'p1', review: 'r0.md', run: 'another-loop', pass: 0, input: [F(1)] });
  const rq = gated(); recordFindings({ root: rq.root, slug: 'p1', review: 'r0.md', run: 'another-loop', pass: 0, input: [F(1)] });
  check('an open Major sighted only in another loop run blocks neither an approve nor the end of a request-changes pass with nothing of its own at the floor (a Major from this run does: the test above)', [review(rn).next, review(rq, { verdict: 'request-changes' }).next], ['close', 'close']);
  const up2 = repo(); const rec = (sev) => recordFindings({ root: up2.root, slug: 'p1', review: 'r0.md', run: 'x', pass: 1, input: [F(1, sev)] }); rec('Minor'); rec('Blocker'); rec('Nit');
  check('somi-findings record raises a known open finding to a stronger severity, notes it on the sighting, and never lowers it', [up2.ledger().findings[0].severity, up2.ledger().findings[0].seen.map((q) => q.severity)], ['Blocker', [undefined, 'Blocker', undefined]]);
  const pc = gated(); const before = pc.state().history.length;
  check('record-pass refuses a verdict with a control character or counts that are not numbers (64), and records nothing', [recordPass(pc.ctx(), { ...prim, verdict: 'a\nb' }).code, recordPass(pc.ctx(), { ...prim, verdict: 'approve', blockers: 'x' }).code, pc.state().history.length], [64, 64, before]);
  const l = repo(); open(l, { max_passes: 1 }); l.file('a.js', '1\n2\n'); after(l); const last = review(l, { verdict: 'request-changes', majors: 1, findings: [F(1)] }); const stop = open(l);
  check('request-changes on the last pass says open, and that open is the max-passes stop (exit 2, close)', [last.next, stop.exit, stop.stop_reason, stop.next], ['open', 2, 'max-passes-exceeded', 'close']);
  const c = gated(); recordPass(c.ctx(), { ...prim, verdict: 'approve' });
  check('a pass the CLI already recorded is refused with a message that says so', review(c).error?.includes('outside the step tool'), true);
}
console.log(`loop step review tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
