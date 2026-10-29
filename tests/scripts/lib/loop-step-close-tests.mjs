#!/usr/bin/env node
// Tests of the composite steps that end a pass and a loop, `after-review` and `close` (scripts/lib/loop-step-review.mjs,
// loop-step-close.mjs): parity with the primitives, the circuit breaker, kill and replay after each sub-step, the diff-gate
// tie, validation and confinement, the closing notes, and the engine's endLoop.
// Run by tests/scripts/loop-engine.sh.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { BUDGET, FIELDS, runStep } from '../../../scripts/lib/loop-step.mjs';
import { checkDiff, documentedStatus, finish, init, pass as passPrim, recordDispatch, recordPass, reviewScope, STOP_REASONS } from '../../../scripts/lib/loop-engine.mjs';
import { CAP_BREACH_STATUSES } from '../../evals/lib/convergence.mjs';
import { ARG, MODES, SUB_STEPS } from '../../../scripts/lib/loop-step-kit.mjs';
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
const ROWS = '# Progress — p1\n\n## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n\n**Last activity**: 2026-10-28 — seeded\n';
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
const close = (r, args = {}, env, o) => step(r, 'close', { status: 'done', ...args }, env, o);
const progress = (r) => readFileSync(path.join(r.root, '.somi', 'plans', 'p1', 'progress.md'), 'utf8');
const review = (r, args = {}, env, o) => step(r, 'after-review', { reviewers: ['somi-reviewer'], verdict: 'approve', blockers: 0, majors: 0, review: 'r1.md', ...args }, env, o);
// A repo at an after-code that passed, with a.js changed by `lines` lines.
const gated = (lines = 3, env) => { const r = repo(); open(r, {}, env); r.file('a.js', '1\n'.repeat(lines)); after(r); return r; };
const bytes = (x) => Buffer.byteLength(JSON.stringify(x));
const tree = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).filter((f) => !f.startsWith('.git')).sort().map((f) => [f, lstatSync(path.join(root, f)).isFile() ? createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex') : 'dir']));
const entries = (r) => r.diary().split('\n').filter((l) => l.startsWith('## ')).length;
const dies = (fn) => { try { fn(); } catch (e) { return e.message; } return 'no throw'; };
// What criterion 2 compares: the state's history, dispatches and caps with times and tree ids dropped, and the ledger with dates dropped.
const norm = (r) => { const s = r.state(); const l = (() => { try { return r.ledger(); } catch { return null; } })();
  return { st: s.status, pass: s.pass, caps: s.caps, co: s.cap_overrides, d: s.dispatches, h: s.history.map(({ at, tree: t, ...h }) => h), l: l && { ...l, findings: l.findings.map((f) => ({ ...f, seen: f.seen.map(({ date, ...x }) => x) })) } }; };
const DATE = () => '2026-10-29';

console.log('== parity with the primitives (criterion 2) ==');
{
  const a = repo(); const b = repo(); const bf = (over) => ({ ...prim, ...over });
  const run = (args) => ({ root: b.root, slug: 'p1', run: b.state().started, now: DATE, ...args });
  open(a); a.file('a.js', '1\n2\n3\n'); after(a);
  const clean = review(a); const closed = close(a);
  init(b.ctx(), prim); passPrim(b.ctx(), prim); b.file('a.js', '1\n2\n3\n'); recordDispatch(b.ctx(), bf({ agent: 'somi-coder' })); checkDiff(b.ctx(), prim); reviewScope(b.ctx(), prim);
  recordDispatch(b.ctx(), bf({ agent: 'somi-reviewer' })); recordPass(b.ctx(), bf({ verdict: 'approve' })); const fin = finish(b.ctx(), bf({ status: 'done' }));
  check('one clean pass through the steps leaves the history, dispatches, caps and cap_overrides of the same pass through the primitives; the step says close with done', [norm(a), clean.next, clean.close_args], [norm(b), 'close', { status: 'done' }]);
  const line = (x) => `${x.agent} ${x.tier} ${x.model}${x.enforced === true ? '' : ' (not enforced)'}`;
  check('close ends the loop as finish does: the same state, and its dispatches as the lines finish lists them', [closed.ok, closed.status, closed.dispatches, closed.cap_overrides], [true, 'done', fin.out.dispatches.map(line), undefined]);
  const c = repo(); const d = repo();
  open(c); c.file('a.js', '1\n2\n'); after(c); const first = review(c, { verdict: 'request-changes', majors: 1, findings: [F(1), F(2, 'Minor')] });
  open(c); c.file('a.js', '1\n2\n3\n'); after(c); const second = review(c, { review: 'r2.md', fixed: ['F-1'] }); close(c);
  init(d.ctx(), prim); passPrim(d.ctx(), prim); d.file('a.js', '1\n2\n'); recordDispatch(d.ctx(), bf({ agent: 'somi-coder' })); recordDispatch(d.ctx(), bf({ agent: 'somi-reviewer' })); recordPass(d.ctx(), bf({ verdict: 'request-changes', majors: '1' }));
  recordFindings({ root: d.root, slug: 'p1', review: 'r1.md', run: d.state().started, pass: 1, input: [F(1), F(2, 'Minor')], now: DATE });
  passPrim(d.ctx(), prim); d.file('a.js', '1\n2\n3\n'); recordDispatch(d.ctx(), bf({ agent: 'somi-coder' })); recordDispatch(d.ctx(), bf({ agent: 'somi-reviewer' })); recordPass(d.ctx(), bf({ verdict: 'approve' })); resolveFinding({ root: d.root, slug: 'p1', id: 'F-1', status: 'fixed', by: 'r2.md' }); finish(d.ctx(), bf({ status: 'done' }));
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
  check('the after-review cursor holds the arguments\' signature and no copy of the review file name', ['sig', 'file'].map((f) => f in ref.state().steps['1:after-review']), [true, false]);
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
console.log('== close: the loop ends, the row moves once, the answer carries what the flow reports ==');
{
  const approved = (env, args) => { const r = repo(); open(r, args, env); r.file('a.js', '1\n2\n3\n'); after(r); review(r); return r; };
  const r = repo(); open(r, { max_passes: 2 });
  const inProgress = /\| 1\.1 \| one \| in-progress \|/.test(progress(r)); r.file('a.js', '1\n2\n3\n'); after(r); review(r);
  const x = close(r);
  check('open marks a not-started row in-progress (one recorded sub-step); close with done ends the loop and answers with the verdict, the diff, the caps and the pointer to the reviews', [inProgress, x.ok, x.exit, x.status, x.next, x.stop_reason, x.pass, x.verdict, x.diff, x.caps.max_passes, x.reviews, r.state().status, r.state().finished], [true, true, 0, 'done', 'summarise', null, 1, 'approve', { lines: 2, weighted: 2, out_of_scope: [] }, 2, '.somi/reviews/p1/', 'done', NOW]);
  check('close with done marks the row once (Status, Reviewed, Last activity), sets the Last activity line and writes a note-category diary entry that folds in the cap overrides', [/\| done +\| approve \| 2026-10-29 — code-loop done at pass 1; verdict approve \|/.test(progress(r)), progress(r).includes('**Last activity**: 2026-10-29 — code-loop done at pass 1; verdict approve for iteration 1.1\n'), /code-loop done at pass 1; verdict approve\n\n\*\*Category\*\*: `note`/.test(r.diary()), r.diary().includes('cap overrides: max_passes 3 -> 2 (tool, after pass 0)'), x.cap_overrides, x.wrote],
    [true, true, true, true, ['max_passes 3 -> 2 (tool, after pass 0)'], ['.somi/plans/p1/diary.md', '.somi/plans/p1/progress.md']]);
  check('close lists every dispatch as agent, tier and model, naming each start the host chose', [x.dispatches.length, x.dispatches.map((d) => d.split(' ')[0])], [2, ['somi-coder', 'somi-reviewer']]);
  const again = close(r); const t = tree(r.root);
  check('a repeat of a finished close is replayed with the same answer and writes nothing; the status step shows its four sub-steps', [again.replayed, again.status, again.dispatches, tree(r.root), step(r, 'status').cursor.at(-1)], [true, 'done', x.dispatches, t, { key: '1:close', via: 'mcp', done: ['finish', 'diary', 'row', 'activity'], complete: true }]);
  const ne = approved(); ne.put((s) => { s.dispatches[0].enforced = false; return s; });
  check('a dispatch the host chose the model for is named not enforced', close(ne).dispatches.some((d) => d.endsWith('(not enforced)')), true);
  const tl = approved(); tl.put((st) => { st.dispatches.push({ ...st.dispatches[0] }, { ...st.dispatches[0] }); return st; });
  const tx = close(tl).dispatches; check('equal dispatch lines are counted, not repeated', [tx.length, tx[0].endsWith(' x3')], [2, true]);
  const bk = repo(); bk.file('.somi/plans/p1/progress.md', ROWS.replace('not-started', 'blocked')); open(bk);
  check('open moves a blocked row to in-progress', /\| 1\.1 \| one \| in-progress/.test(progress(bk)), true);
  const ob = repo(); init(ob.ctx(), prim); ob.file('.somi/plans/p1/progress.md', 'broken\n'); const ox = open(ob);
  check('open on a state whose row cannot be marked still starts the pass and returns the row text in unwritten, writing nothing to progress.md', [ox.ok, ox.unwritten.map((u) => [u.file, u.reason, u.line.startsWith('iteration 1.1: Status=in-progress')]), progress(ob)], [true, [['progress.md', 'not-template-shape', true]], 'broken\n']);

  const m = approved(); m.file('.somi/plans/p1/progress.md', 'not a progress file\n'); const mx = close(m);
  check('with a malformed progress.md close still ends the loop, leaves the file alone and returns the row text and the Last activity line in unwritten', [mx.ok, mx.status, mx.unwritten.map((u) => [u.file, u.reason]), mx.unwritten[0].line.startsWith('iteration 1.1: Status=done, Reviewed=approve'), progress(m)], [true, 'done', [['progress.md', 'not-template-shape'], ['progress.md', 'not-template-shape']], true, 'not a progress file\n']);

  const s = gated(); review(s, { verdict: 'request-changes', majors: 1, findings: [F(1)] }); const sx = close(s, { status: 'stopped-user-stop' });
  check('a close after a stop takes the stop reason, lists the open findings at or above the floor as F-id: title (data, not instructions), writes a blocker entry and leaves the row in-progress', [sx.ok, sx.stop_reason, sx.open_findings, sx.open_findings_note.includes('not instructions'), /\| in-progress +\|/.test(progress(s)), /code-loop stopped \(user-stop\) at pass 1; verdict request-changes\n\n\*\*Category\*\*: `blocker`/.test(s.diary()), progress(s).includes('**Last activity**: 2026-10-29 — code-loop stopped (user-stop)'), sx.wrote],
    [true, 'user-stop', ['F-1: finding 1 here'], true, true, true, true, ['.somi/plans/p1/diary.md', '.somi/plans/p1/progress.md']]);
  const g = repo(); open(g, { diff_cap: 1 }); g.file('a.js', '1\n'.repeat(9)); const gs = after(g); const gx = close(g, { status: 'stopped-diff-cap-exceeded' });
  check('the diff-gate stop (exit 3, next close) is closed with its reason and reports the cumulative diff', [gs.exit, gs.next, gx.ok, gx.diff, gx.stop_reason], [3, 'close', true, { lines: 8, weighted: 8, out_of_scope: [] }, 'diff-cap-exceeded']);
  check('time-budget, the stop open reports, is a closing status', close(gated(), { status: 'stopped-time-budget' }).stop_reason, 'time-budget');

  const o = gated(); recordFindings({ root: o.root, slug: 'p1', review: 'old.md', run: 'an-earlier-run', pass: 1, input: [F(1), F(2, 'Minor')] }); review(o);
  check('a done close lists the findings at or above the floor an earlier run of the iteration left, and not those below it', close(o).open_findings, ['F-1: finding 1 here']);

  const pl = repo(); const ps = (st, a = {}) => runStep(pl.ctx(), { step: st, slug: 'pl', loop: 'plan', ...a });
  ps('open'); ps('after-code', { agent: 'somi-planner' }); ps('after-review', { reviewers: ['somi-reviewer'], verdict: 'approve', blockers: 0, majors: 0, review: 'r1.md' });
  const px = ps('close', { status: 'done' }); const plp = readFileSync(path.join(pl.root, '.somi', 'plans', 'pl', 'progress.md'), 'utf8');
  check('a plan loop closes done without a row: the awaiting-approval Status line comes back in unwritten, Last activity is set, the loop is over', [px.ok, px.unwritten.map((u) => [u.file, u.reason, u.line]), plp.includes('| 1.1 | one | not-started'), plp.includes('— plan-loop done at pass 1; verdict approve'), JSON.parse(readFileSync(stateFile(pl.ctx().stateDir, 'pl', ''), 'utf8')).status], [true, [['progress.md', 'status-not-set-by-tool', 'set the Status line to awaiting-approval']], true, true, 'done']);

  const big = approved(); big.put((st) => ({ ...st, dispatches: Array.from({ length: 40 }, (_, i) => ({ pass: 1, agent: `agent-${i}`, tier: 'medium', model: 'model-x', enforced: i % 2 === 0 })), cap_overrides: Array.from({ length: 30 }, (_, i) => ({ field: 'max_passes', from: 30 - i, to: 29 - i, source: 'tool', after_pass: 1, at: NOW })) }));
  recordFindings({ root: big.root, slug: 'p1', review: 'old.md', run: 'an-earlier-run', pass: 1, input: Array.from({ length: 300 }, (_, i) => F(i + 1)) }); const bx = close(big);
  check('40 dispatches, 30 cap overrides and 300 open findings: the answer fits the budget, every list counts what it cuts', [bx.ok, bytes(bx) <= BUDGET, bx.truncated, [bx.dispatches, bx.cap_overrides, bx.open_findings].map((l) => l.at(-1).startsWith('(+'))], [true, true, undefined, [true, true, true]]);
  check('the fold of dispatches and cap overrides does not point at the loop state, which is not kept in the repository', [bx.dispatches, bx.cap_overrides].map((l) => l.at(-1).includes('loop state')), [false, false]);
}
console.log('== close: what it refuses, and what a kill or a failed measurement leaves ==');
{
  const reviewed = (args) => { const r = gated(); if (args) review(r, args); else review(r); return r; };
  const two = reviewed({ verdict: 'request-changes', majors: 1, findings: [F(1)] }); open(two); two.file('a.js', '1\n2\n'); after(two); review(two, { verdict: 'request-changes', majors: 1, findings: [F(1)] });
  const refused = [['no after-review yet', gated(), {}], ['request-changes with a Major open', reviewed({ verdict: 'request-changes', majors: 1, findings: [F(1)] }), {}], ['the circuit breaker', two, {}], ['status finished', reviewed(), { status: 'finished' }], ['an undocumented reason', reviewed(), { status: 'stopped-whatever' }], ['an empty reason', reviewed(), { status: 'stopped-' }],
    ['no status', reviewed(), { status: undefined }], ['status as a list', reviewed(), { status: ['done'] }], ['a plan loop asked to close a code loop\'s slug', reviewed(), { loop: 'plan', iteration: undefined }]];
  const got = refused.map(([, r, a]) => { const t = tree(r.root); const x = close(r, a); return [x.exit, x.error?.startsWith(a.loop ? 'no running loop' : 'status:'), isDeepStrictEqual(tree(r.root), t), r.state().status, '1:close' in r.state().steps]; });
  check('a done close without an ending after-review, an undocumented or missing status and a wrong loop are each refused 64 naming the field or the missing state, with the loop still running and nothing written', got, refused.map(() => [64, true, true, 'running', false]));
  check('the breaker pass is closed with its own reason', close(two, { status: 'stopped-circuit-breaker' }).stop_reason, 'circuit-breaker');
  const fin = reviewed(); finish(fin.ctx(), { ...prim, status: 'done' }); const ft = tree(fin.root); const fx = close(fin);
  check('a loop that was finished outside the step is refused 64 as already finished, and nothing is written', [fx.exit, fx.error?.includes('already finished'), tree(fin.root)], [64, true, ft]);
  const dn = reviewed(); close(dn); const dt = tree(dn.root); const other = close(dn, { status: 'stopped-user-stop' });
  check('a finished close repeated with another status is refused 64, not answered with the stored one', [other.exit, other.error?.startsWith('status:'), tree(dn.root)], [64, true, dt]);

  const whole = reviewed(); const wx = close(whole);
  const shape = (r) => [r.state().status, r.state().finished, entries(r), (progress(r).match(/\| done /g) ?? []).length, progress(r).match(/\*\*Last activity\*\*.*/)[0]];
  const kills = ['finish', 'diary', 'row', 'activity'].map((sub) => { const r = reviewed(); const k = dies(() => close(r, {}, {}, { failAfter: sub })); const x = close(r); return [k, x.ok, x.replayed, x.wrote, x.status, shape(r)]; });
  check('close killed after each of its four sub-steps and retried ends the loop once: one diary entry, one done row, one Last activity line, the same answer as an uninterrupted call', kills, ['finish', 'diary', 'row', 'activity'].map((s) => [`failAfter ${s}`, true, false, wx.wrote, 'done', shape(whole)]));

  const gf = reviewed(); const sha = gf.state().baseline_sha; gf.put((s) => ({ ...s, baseline_sha: 'f'.repeat(40) })); const before = readFileSync(gf.sf, 'utf8'); const gx = close(gf);
  check('when the cumulative diff cannot be measured the loop is left running and untouched (no closing entry), and the same close succeeds once it can', [gx.ok, readFileSync(gf.sf, 'utf8') === before, entries(gf), (gf.put((s) => ({ ...s, baseline_sha: sha })), close(gf).ok), gf.state().status], [false, true, 3, true, 'done']);

  const tamper = (fn) => { const r = reviewed(); r.put((s) => { fn(s.steps['1:open']); return s; }); return step(r, 'status').exit; };
  check('a stored cursor with a diff or a status of the wrong shape makes the state unreadable', [tamper((e) => { e.diff = { lines: 'x', weighted: 1, out_of_scope: [] }; }), tamper((e) => { e.status = 'stopped-x'; }), tamper((e) => { e.diff = { lines: 1, weighted: 1, out_of_scope: [] }; e.status = 'done'; })], [64, 64, 0]);
}
console.log('== close: stopped loops, plan loops, gate stops, and the resume path of open ==');
{
  const rc = { verdict: 'request-changes', majors: 1, findings: [F(1)] };
  const lp = gated(); review(lp, rc); open(lp); const lx = close(lp, { status: 'stopped-user-stop' });
  check('a loop stopped in a pass that has no review yet names the last recorded verdict as that pass\'s: in the diary, the Last activity line and the answer', [lx.verdict, lx.verdict_pass, lx.pass, lp.diary().includes('code-loop stopped (user-stop) at pass 2; last verdict request-changes (pass 1)\n'), progress(lp).includes('— code-loop stopped (user-stop) at pass 2; last verdict request-changes (pass 1) for iteration 1.1')], ['request-changes', 1, 2, true, true]);

  const st = gated(); review(st, rc); const stx = close(st, { status: 'stopped-user-stop' });
  const dn = gated(); recordFindings({ root: dn.root, slug: 'p1', review: 'old.md', run: 'an-earlier-run', pass: 1, input: [F(1)] }); review(dn); const dnx = close(dn);
  check('the closing diary entry lists the open findings at or above the floor by id', [st.diary().includes('open at or above Major: F-1'), dn.diary().includes('open at or above Major: F-1')], [true, true]);
  check('the note on the open findings is specific to the close: a stop says to record each as a follow-up by id, a done close only says they are still open at close and asks for nothing', [stx.open_findings_note.includes('record each in progress.md as a follow-up, by its id'), dnx.open_findings_note.includes('still open at close'), dnx.open_findings_note.includes('follow-up') || dnx.open_findings_note.includes('earlier runs')], [true, true, false]);
  const ks = gated(); review(ks, rc); const kerr = dies(() => close(ks, { status: 'stopped-user-stop' }, {}, { failAfter: 'finish' }));
  recordFindings({ root: ks.root, slug: 'p1', review: 'r9.md', run: ks.state().started, pass: 1, input: [F(2)] }); close(ks, { status: 'stopped-user-stop' });
  check('a closing diary entry written on a retry lists the findings read when the loop was ended, not those recorded since', [kerr, /open at or above Major: F-1(?!,)/.test(ks.diary()), entries(ks)], ['failAfter finish', true, 4]);

  const sa = gated(); review(sa, rc); const sax = close(sa, { status: 'stopped-user-stop' });
  const sb = gated(); review(sb, rc); finish(sb.ctx(), { ...prim, status: 'stopped-user-stop' });
  check('a stopped close leaves the state that finish --status stopped-user-stop leaves', [sax.ok, norm(sa), sa.state().finished], [true, norm(sb), sb.state().finished]);

  const rs = repo(); init(rs.ctx(), prim); passPrim(rs.ctx(), prim); recordPass(rs.ctx(), { ...prim, verdict: 'request-changes', majors: '1' }); const rx = open(rs);
  check('open on a pass the primitives recorded is a resume: the row moves to in-progress and the diary entry says resumed', [rx.ok, /\| 1\.1 \| one \| in-progress/.test(progress(rs)), rs.diary().includes('resumed from pass 1')], [true, true, true]);
  const rk = repo(); init(rk.ctx(), prim); passPrim(rk.ctx(), prim); recordPass(rk.ctx(), { ...prim, verdict: 'request-changes', majors: '1' }); const rkerr = dies(() => open(rk, {}, {}, { failAfter: 'diary' })); const rkx = open(rk);
  check('a resume killed after its diary entry moves the row on the retry and writes the entry once', [rkerr, rkx.ok, /\| 1\.1 \| one \| in-progress/.test(progress(rk)), entries(rk)], ['failAfter diary', true, true, 2]);
  const rb = repo(); rb.file('.somi/plans/p1/progress.md', ROWS.replace('not-started', 'blocked')); init(rb.ctx(), prim); passPrim(rb.ctx(), prim); recordPass(rb.ctx(), { ...prim, verdict: 'request-changes', majors: '1' }); const rbx = open(rb);
  check('a resumed open leaves a row a person marked blocked as it is, says so in unwritten, and still starts the pass and writes the entry', [rbx.ok, rbx.pass, /\| 1\.1 \| one \| blocked/.test(progress(rb)), rb.diary().includes('resumed from pass 1'), rbx.unwritten.map((u) => [u.file, u.reason])], [true, 2, true, true, [['progress.md', 'row-left-blocked']]]);

  const pg = repo(); const pp = (name, a = {}) => runStep(pg.ctx(), { step: name, slug: 'pl', loop: 'plan', ...a });
  pp('open'); pp('after-code', { agent: 'somi-planner' }); const t0 = tree(pg.root); const early = pp('close', { status: 'done' });
  pp('after-review', { reviewers: ['somi-reviewer'], verdict: 'request-changes', blockers: 0, majors: 1, review: 'r1.md', findings: [F(1)] }); const t1 = tree(pg.root); const mid = pp('close', { status: 'done' });
  check('a plan loop is gated like a code loop: done is refused 64 before any after-review and after one that did not end the loop, the loop stays running and nothing is written', [early.exit, mid.exit, early.error?.startsWith('status:'), isDeepStrictEqual(tree(pg.root), t1), t0 === t1, JSON.parse(readFileSync(stateFile(pg.ctx().stateDir, 'pl', ''), 'utf8')).status], [64, 64, true, true, false, 'running']);

  const g1 = repo(); open(g1, { max_passes: 1 }); g1.file('a.js', '1\n2\n'); after(g1); review(g1, rc); const e2 = open(g1);
  const g3 = repo(); open(g3, { diff_cap: 1 }); g3.file('a.js', '1\n'.repeat(9)); const e3 = after(g3);
  const g4 = repo(); mkdirSync(path.join(g4.root, '.somi', 'somi-state', 'run'), { recursive: true }); writeFileSync(path.join(g4.root, '.somi', 'somi-state', 'run', 'p1.json'), JSON.stringify({ started: '2020-01-01T00:00:00.000Z', max_minutes: 1 })); const e4 = open(g4);
  check('a gate stop (max passes, diff cap, time budget) carries the status to close with, and close accepts it', [e2, e3, e4].map((x) => [x.exit, x.close_args?.status === `stopped-${x.stop_reason}`, documentedStatus(x.close_args?.status)]), [[2, true, true], [3, true, true], [4, true, true]]);
  check('the exported step tables and the stop reasons cannot be changed by a caller', [STOP_REASONS, FIELDS, ...Object.values(FIELDS)].every(Object.isFrozen), true);
}
console.log('== close and the step tool: cursors from an earlier build, labels, finding keys ==');
{
  const ok = gated(); review(ok, { verdict: 'request-changes', majors: 1, findings: [F(1)] }); dies(() => close(ok, { status: 'stopped-user-stop' }, {}, { failAfter: 'finish' }));
  ok.put((s) => { delete s.steps['1:close'].open; return s; }); const okx = close(ok, { status: 'stopped-user-stop' });
  check('a close resumed from a cursor that was finished without its open-findings record reads the ledger now instead of failing', [okx.ok, okx.exit, okx.open_findings, ok.diary().includes('open at or above Major: F-1')], [true, 0, ['F-1: finding 1 here'], true]);

  const wa = gated(); const wt = tree(wa.root); const wb = review(wa, { findings: [{ ...F(1, 'Minor'), extra: { a: { b: 1 } } }], verdict: 'approve' });
  check('a finding with a key outside file, symbol, title, severity and confidence is refused 64 naming findings, and nothing is written', [wb.exit, wb.error?.startsWith('findings:'), isDeepStrictEqual(tree(wa.root), wt)], [64, true, true]);

  const np = gated(); review(np, { verdict: 'request-changes', majors: 1, findings: [F(1)] }); open(np); np.put((s) => { delete s.history[0].pass; return s; }); const npx = close(np, { status: 'stopped-user-stop' });
  check('a history entry without a pass number is named by its verdict alone, never "(pass null)"', [npx.ok, np.diary().includes('null'), np.diary().includes('last verdict request-changes\n'), npx.verdict_pass], [true, false, true, null]);
}
console.log('== endLoop, the statuses close accepts, the shared constants, the ledger temp sweep ==');
{
  const e = repo(); init(e.ctx(), prim); finish(e.ctx(), { ...prim, status: 'approved' }); const once = readFileSync(e.sf, 'utf8'); const twice = finish(e.ctx(), { ...prim, status: 'stopped-user-stop' });
  check('finish keeps accepting the statuses the CLI always took, and a loop that is over cannot be finished again: 64, and the state is unchanged', [twice.code, twice.message.includes('cannot be finished again'), readFileSync(e.sf, 'utf8') === once], [64, true, true]);
  check('the documented closing statuses are done and stopped- with a reason the code loop documents, time-budget included, and cover every cap-breach status the eval reads', [['done', 'stopped-user-stop', 'stopped-time-budget', 'stopped-circuit-breaker'].map(documentedStatus), ['approved', 'stopped-done', 'stopped-', 'stopped-x', 'stopped-__proto__', '', null, ['done']].map(documentedStatus), [...CAP_BREACH_STATUSES].every((r) => STOP_REASONS.includes(r))], [Array(4).fill(true), Array(8).fill(false), true]);
  check('the exported sub-step, mode and argument tables cannot be changed by a caller', [MODES, ARG, SUB_STEPS].map(Object.isFrozen), [true, true, true]);

  const r = repo(); const dir = path.join(r.root, '.somi', 'reviews', 'p1'); mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 2 * 3600 * 1000); const plant = (name, text = 'x') => { writeFileSync(path.join(dir, name), text); utimesSync(path.join(dir, name), old, old); };
  plant('findings.json.0123456789ab.tmp'); plant('findings.json.0123456789ac.tmp'); plant('findings.json.short.tmp'); plant('notes.txt'); writeFileSync(path.join(dir, 'findings.json.0123456789ad.tmp'), 'fresh');
  const away = path.join(tmp, 'sweep-target.txt'); writeFileSync(away, 'untouched'); symlinkSync(away, path.join(dir, 'findings.json.0123456789ae.tmp')); lutimesSync(path.join(dir, 'findings.json.0123456789ae.tmp'), old, old);
  recordFindings({ root: r.root, slug: 'p1', review: 'r', run: 'x', pass: 1, input: [F(1)] });
  check('a save sweeps the temp files of killed writes that are old regular files, and leaves a young one, a link, other names and the link target alone', [readdirSync(dir).sort(), readFileSync(away, 'utf8')], [['findings.json', 'findings.json.0123456789ad.tmp', 'findings.json.0123456789ae.tmp', 'findings.json.short.tmp', 'notes.txt'], 'untouched']);
}
console.log(`loop step review and close tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
