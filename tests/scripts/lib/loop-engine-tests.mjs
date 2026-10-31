#!/usr/bin/env node
// In-process tests of the loop engine libraries: scripts/lib/loop-caps.mjs, loop-exit.mjs, loop-state.mjs and
// loop-engine.mjs (the lifecycle, measuring and recording handlers).
// Invoked from tests/scripts/loop-engine.sh.

import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { applyCapOverride, configVal, firstDefined, resolveInitCap, reresolveCap, validateCap } from '../../../scripts/lib/loop-caps.mjs';
import { checkDiff, finish, init, pass as passPass, recordDispatch, recordPass, resume, reviewScope, runStart } from '../../../scripts/lib/loop-engine.mjs';
import { stateFile } from '../../../scripts/lib/loop-state.mjs';
import { measuredTree, treeNumstat } from '../../../scripts/lib/loop-review.mjs';
import { computeDiff } from '../../../scripts/lib/loop-diff.mjs';
import { LoopExit, ok, refuse, usageError } from '../../../scripts/lib/loop-exit.mjs';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'lib');
let pass = 0; let fail = 0;
// Strict deep equality: undefined, null and a missing key are three different answers (a refusal's `out` must be absent).
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
// What a call that should exit looks like: [class, code, message], or the string 'no throw'.
const exitOf = (fn) => {
  try { fn(); } catch (e) { return [e instanceof LoopExit, e.code, e.message]; }
  return 'no throw';
};

console.log('== loop caps: the environment is a parameter ==');
process.env.SOMI_CODE_LOOP_MAX_PASSES = '9';
process.env.SOMI_CODE_LOOP_DIFF_CAP = '999';
check('resolveInitCap({}) ignores process.env and gives the default 3', resolveInitCap({}, {}, 'code', 'max_passes', ''), 3);
check('resolveInitCap({}) ignores process.env for the diff cap too (default 400)', resolveInitCap({}, {}, 'code', 'diff_cap_lines', ''), 400);
check('the env it is handed is what counts', resolveInitCap({ SOMI_CODE_LOOP_MAX_PASSES: '5' }, {}, 'code', 'max_passes', ''), 5);
check('reresolveCap({}) ignores process.env: no override, the stored cap stands', reresolveCap({}, { loop: 'code', pass: 1, caps: { max_passes: 2 } }, 'max_passes', '', 'T'), { resolved: 2, override: null });
delete process.env.SOMI_CODE_LOOP_MAX_PASSES;
delete process.env.SOMI_CODE_LOOP_DIFF_CAP;
const sources = ['loop-caps.mjs', 'loop-exit.mjs', 'loop-state.mjs', 'loop-engine.mjs'].map((f) => [f, readFileSync(path.join(LIB, f), 'utf8')]);
for (const [f, src] of sources) {
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  check(`${f} has no process.env outside comments`, /process\s*(\.|\[)\s*['"]?env/.test(code), false);
}

console.log('== loop caps: precedence ==');
const cfg = { code_loop: { max_passes: 7 }, plan_loop: { max_passes: 6 } };
check('flag beats env, config and default', resolveInitCap({ SOMI_CODE_LOOP_MAX_PASSES: '5' }, cfg, 'code', 'max_passes', '2'), 2);
check('env beats config', resolveInitCap({ SOMI_CODE_LOOP_MAX_PASSES: '5' }, cfg, 'code', 'max_passes', ''), 5);
check('config beats the default', resolveInitCap({}, cfg, 'code', 'max_passes', ''), 7);
check('a plan loop reads its own env var and config section', [resolveInitCap({ SOMI_PLAN_LOOP_MAX_PASSES: '4' }, cfg, 'plan', 'max_passes', ''), resolveInitCap({}, cfg, 'plan', 'max_passes', '')], [4, 6]);
check('a plan loop has no diff cap, whatever is set', resolveInitCap({ SOMI_CODE_LOOP_DIFF_CAP: '50' }, {}, 'plan', 'diff_cap_lines', '80'), 0);
check('a numeric 0 counts as set (the gate off is explicit)', resolveInitCap({}, {}, 'code', 'diff_cap_lines', '0'), 0);
check('configVal walks keys and reads null as unset', [configVal(cfg, ['code_loop', 'max_passes']), configVal({ a: null }, ['a']), configVal({}, ['a', 'b'])], [7, undefined, undefined]);
check('firstDefined skips undefined, null and the empty string', firstDefined(undefined, null, '', 0, 3), 0);

console.log('== loop caps: malformed values are refused, not coerced ==');
for (const raw of ['1,000', 'unlimited', '-1', '1.5']) {
  check(`validateCap(${JSON.stringify(raw)}) exits 64 with the label and the value`, exitOf(() => validateCap(raw, 'max_passes')), [true, 64, `somi-loop: max_passes: expected a non-negative integer, got "${raw}"`]);
}
check('validateCap accepts 0 and a plain integer', [validateCap('0', 'x'), validateCap(12, 'x')], [0, 12]);
check('a malformed env cap at init exits 64 naming the field', exitOf(() => resolveInitCap({ SOMI_CODE_LOOP_MAX_PASSES: 'unlimited' }, {}, 'code', 'max_passes', '')), [true, 64, 'somi-loop: max_passes: expected a non-negative integer, got "unlimited"']);
const st = (extra = {}) => ({ loop: 'code', pass: 2, caps: { max_passes: 3, diff_cap_lines: 400 }, ...extra });
check('a malformed flag on re-resolution names the flag', exitOf(() => reresolveCap({}, st(), 'max_passes', '1,000', 'T')), [true, 64, 'somi-loop: --max-passes: expected a non-negative integer, got "1,000"']);
check('a malformed env var on re-resolution names the variable', exitOf(() => reresolveCap({ SOMI_CODE_LOOP_DIFF_CAP: 'none' }, st(), 'diff_cap_lines', '', 'T')), [true, 64, 'somi-loop: SOMI_CODE_LOOP_DIFF_CAP: expected a non-negative integer, got "none"']);

console.log('== loop caps: re-resolution and the override entry ==');
const flagged = reresolveCap({ SOMI_CODE_LOOP_MAX_PASSES: '8' }, st(), 'max_passes', '5', '2026-01-01T00:00:00Z');
check('a flag beats the env var and records source cli with the caller-supplied time', flagged, { resolved: 5, override: { field: 'max_passes', from: 3, to: 5, source: 'cli', after_pass: 2, at: '2026-01-01T00:00:00Z' } });
check('an env var alone records source env', reresolveCap({ SOMI_CODE_LOOP_DIFF_CAP: '100' }, st(), 'diff_cap_lines', '', 'T').override.source, 'env');
check('an explicit value equal to the stored one is no override', reresolveCap({ SOMI_CODE_LOOP_MAX_PASSES: '3' }, st(), 'max_passes', '', 'T'), { resolved: 3, override: null });
check('a plan loop has no diff cap to re-resolve', reresolveCap({ SOMI_CODE_LOOP_DIFF_CAP: '100' }, st({ loop: 'plan' }), 'diff_cap_lines', '100', 'T'), { resolved: 0, override: null });
const live = st();
applyCapOverride(live, flagged.override);
applyCapOverride(live, { ...flagged.override, from: 5, to: 6 });
check('applyCapOverride sets the cap and appends to a lazily created trail', [live.caps.max_passes, live.cap_overrides.length, live.cap_overrides[0].to], [6, 2, 5]);
check('a state never overridden keeps its shape (no cap_overrides key)', 'cap_overrides' in st(), false);

console.log('== loop exit model ==');
const e = usageError('bad');
check('usageError is a LoopExit 64 with the program prefix', [e instanceof LoopExit, e instanceof Error, e.code, e.message], [true, true, 64, 'somi-loop: bad']);
check('ok carries the output and no message', ok({ a: 1 }), { out: { a: 1 }, code: 0, message: '' });
check('refuse carries no stdout by default', refuse(2, 'max-passes-exceeded'), { out: undefined, code: 2, message: 'max-passes-exceeded' });
check('refuse can carry stdout printed before the failure', refuse(3, 'over', { cap: 1 }), { out: { cap: 1 }, code: 3, message: 'over' });

console.log('== loop lifecycle: handlers return results, the environment is a parameter ==');
const root = mkdtempSync(path.join(tmpdir(), 'loop-engine-'));
const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
git('init', '-q'); git('commit', '-q', '--allow-empty', '-m', 'base');
const stateDir = path.join(root, '.somi', 'somi-state', 'loop');
// SOMI_GLOBAL_CONFIG='' switches the developer's global config off, so no handler here reads outside the temp root.
const ctxFor = (env = {}) => ({ root, env: { SOMI_GLOBAL_CONFIG: '', ...env }, stateDir, now: () => '2026-01-01T00:00:00Z' });
const base = { slug: 's', loop: 'code', iteration: '', files: 'a.js b.js', force: false, status: '', maxPasses: '', diffCap: '', severity: '', maxMinutes: '' };
const envBefore = JSON.stringify(process.env);
process.env.SOMI_CODE_LOOP_MAX_PASSES = '9';
process.env.SOMI_CODE_LOOP_SEVERITY_FLOOR = 'Blocker';
const globalDir = mkdtempSync(path.join(tmpdir(), 'loop-global-')); // outside root, or it counts as untracked diff
const globalCfg = path.join(globalDir, 'config.json'); // a global config the process env points at; the handler's env must not follow it
writeFileSync(globalCfg, JSON.stringify({ code_loop: { max_passes: 7 } }));
const globalBefore = process.env.SOMI_GLOBAL_CONFIG;
process.env.SOMI_GLOBAL_CONFIG = globalCfg;
const sentinel = init(ctxFor(), { ...base, slug: 'sentinel' });
check('an in-process init ignores sentinels planted in process.env (caps, severity floor, global config)', [sentinel.code, sentinel.out.caps.max_passes, sentinel.out.caps.severity_floor], [0, 3, 'Major']);
delete process.env.SOMI_CODE_LOOP_MAX_PASSES;
delete process.env.SOMI_CODE_LOOP_SEVERITY_FLOOR;
if (globalBefore === undefined) delete process.env.SOMI_GLOBAL_CONFIG; else process.env.SOMI_GLOBAL_CONFIG = globalBefore;
check('a handler given a global-config path in its env does read it (the sentinel file is live)', init(ctxFor({ SOMI_GLOBAL_CONFIG: globalCfg }), { ...base, slug: 'g' }).out.caps.max_passes, 7);
const started = init(ctxFor({ SOMI_CODE_LOOP_MAX_PASSES: '2' }), base);
check('init succeeds with the golden output keys and the env-given cap', [started.code, started.message, Object.keys(started.out), started.out.caps], [0, '', ['baseline_sha', 'caps', 'state_file'], { max_passes: 2, diff_cap_lines: 400, severity_floor: 'Major' }]);
const sf = stateFile(stateDir, 's', '');
check('the state file holds the golden state shape, in order', Object.keys(JSON.parse(readFileSync(sf, 'utf8'))), ['slug', 'loop', 'iteration', 'baseline_sha', 'started', 'status', 'caps', 'iteration_files', 'pass', 'history']);
const again = init(ctxFor(), base);
check('init over a running state is refused (64) with no stdout', [again.code, again.out, again.message], [64, undefined, `somi-loop: loop state already running at ${sf} — use 'resume' to continue it, or 'init --force' to discard`]);
passPass(ctxFor(), base);
const forced = init(ctxFor({ SOMI_CODE_LOOP_MAX_PASSES: '2' }), { ...base, force: true });
check('init --force discards a running state: success, and the pass counter is back to 0', [forced.code, JSON.parse(readFileSync(sf, 'utf8')).pass], [0, 0]);
mkdirSync(path.join(root, '.somi', 'plans', 'bo'), { recursive: true });
const briefOnly = init(ctxFor(), { ...base, slug: 'bo' });
check('a brief-only work item without a tier approval is refused (64) with no stdout', [briefOnly.code, briefOnly.out, briefOnly.message.startsWith('somi-loop: brief-only work item refused: ')], [64, undefined, true]);
check('pass 1 and 2 of a cap-2 loop succeed', [passPass(ctxFor({ SOMI_CODE_LOOP_MAX_PASSES: '2' }), base).out, passPass(ctxFor({ SOMI_CODE_LOOP_MAX_PASSES: '2' }), base).out], [{ pass: 1, max_passes: 2 }, { pass: 2, max_passes: 2 }]);
const third = passPass(ctxFor(), base);
check('pass 3 of a cap-2 loop comes back as code 2 with no stdout', [third.code, third.out, third.message], [2, undefined, 'max-passes-exceeded: pass 3 > cap 2']);
mkdirSync(path.join(root, '.somi', 'somi-state', 'run'), { recursive: true });
writeFileSync(path.join(root, '.somi', 'somi-state', 'run', 's.json'), JSON.stringify({ started: '2000-01-01T00:00:00Z', max_minutes: 5 }));
const late = passPass(ctxFor({ SOMI_CODE_LOOP_MAX_PASSES: '9' }), base);
check('pass over the run budget comes back as code 4 with no stdout', [late.code, late.out, late.message.startsWith('time-budget-exceeded: ')], [4, undefined, true]);
const planLoop = init(ctxFor(), { ...base, slug: 'p', loop: 'plan' });
check('a plan loop has no diff cap and no review_min', [planLoop.out.caps.diff_cap_lines, 'review_min' in planLoop.out], [0, false]);
const done = finish(ctxFor(), { ...base, status: 'approved' });
check('finish records the status, the cap raise from the env var, and the injected clock', [done.out, JSON.parse(readFileSync(sf, 'utf8')).finished], [{ status: 'approved', pass: 2, history: 0, cap_overrides: [{ field: 'max_passes', from: 2, to: 9, source: 'env', after_pass: 2, at: '2026-01-01T00:00:00Z' }] }, '2026-01-01T00:00:00Z']);
check('finish without --status is a usage error (64)', finish(ctxFor(), base).code, 64);
check('resume reads a missing state as 64', resume(ctxFor(), { ...base, slug: 'none' }).code, 64);
check('none of the lifecycle calls touched process.env', JSON.stringify(process.env), envBefore);

console.log('== loop measure and record: results carry their stdout and their code ==');
const mCtx = (env = {}) => ({ ...ctxFor(env), installRoot: path.join(LIB, '..', '..') });
const m = { ...base, slug: 'm', files: 'a.js', diffCap: '4' };
init(mCtx(), m);
writeFileSync(path.join(root, 'a.js'), '1\n2\n3\n');
writeFileSync(path.join(root, 'c.js'), '1\n2\n');
const over = checkDiff(mCtx(), m);
check('check-diff over the weighted cap returns code 3 with its JSON and the stderr line', [over.code, over.out, over.message], [3, { diff_lines: 5, weighted_lines: 7, cap: 4, out_of_scope: ['c.js'] }, 'diff-cap-exceeded: weighted 7 > cap 4 (out-of-scope counts double)']);
const raised = checkDiff(mCtx({ SOMI_CODE_LOOP_DIFF_CAP: '100' }), { ...m, diffCap: '' });
check('check-diff under a raised cap is code 0 with the same measurement', [raised.code, raised.out.weighted_lines, raised.out.cap], [0, 7, 100]);
const firstScope = reviewScope(mCtx(), m);
check('review-scope on pass 0 is the whole iteration', [firstScope.code, firstScope.out], [0, { scope: 'full', why: 'first-pass' }]);
check('review-scope honours the env setting and refuses a bad one (64)', [reviewScope(mCtx({ SOMI_CODE_LOOP_REVIEW_SCOPE: 'full' }), m).out.why, reviewScope(mCtx({ SOMI_CODE_LOOP_REVIEW_SCOPE: 'x' }), m).code], ['setting', 64]);
passPass(mCtx({ SOMI_CODE_LOOP_MAX_PASSES: '5' }), m);
const rec = recordPass(mCtx(), { ...m, verdict: 'needs-changes', blockers: '1', majors: '2' });
check('record-pass returns the history entry with the diff size and the reviewed tree', [rec.code, rec.out.pass, rec.out.verdict, rec.out.blockers, rec.out.majors, rec.out.diff_lines, typeof rec.out.tree], [0, 1, 'needs-changes', 1, 2, 5, 'string']);
check('record-pass without --verdict is a usage error (64)', recordPass(mCtx(), m).code, 64);
passPass(mCtx({ SOMI_CODE_LOOP_MAX_PASSES: '5' }), m);
writeFileSync(path.join(root, 'a.js'), '1\n2\n3\n4\n');
const delta = reviewScope(mCtx(), m);
check('review-scope on a middle pass is the delta since the reviewed tree', [delta.out.scope, delta.out.since_pass, delta.out.files], ['delta', 1, ['a.js']]);
const agent = recordDispatch(mCtx(), { ...m, agent: 'somi-coder' });
check('record-dispatch appends the resolver\'s answer for a known agent', [agent.code, agent.out.agent, agent.out.pass], [0, 'somi-coder', 2]);
const nobody = recordDispatch(mCtx(), { ...m, agent: 'no-such-agent' });
check('record-dispatch refuses an unknown agent with the resolver\'s code (65) and no stdout', [nobody.code, nobody.out, nobody.message.startsWith('somi-loop: ')], [65, undefined, true]);
check('record-dispatch without --agent is a usage error (64)', recordDispatch(mCtx(), m).code, 64);
check('run-start records the budget, keeps it on a repeat, and refuses a zero budget (64)', [runStart(mCtx(), { ...m, maxMinutes: '30' }).out.max_minutes, runStart(mCtx(), { ...m, maxMinutes: '45' }).out.resumed, runStart(mCtx(), { ...m, slug: 'z', maxMinutes: '0' }).code], [30, true, 64]);
check('none of the measure and record calls touched process.env', JSON.stringify(process.env), envBefore);
{ // init creates the state directory only just before it saves, so a refused init leaves nothing behind
  const bare = mkdtempSync(path.join(tmpdir(), 'loop-bare-'));
  const bctx = { root: bare, env: { SOMI_GLOBAL_CONFIG: '' }, stateDir: path.join(bare, '.somi', 'somi-state', 'loop'), now: () => '2026-01-01T00:00:00Z' };
  const refused = [init(bctx, { ...base, slug: 'x', severity: 'nope' }).code, init(bctx, { ...base, slug: 'x' }).code]; // a bad floor, then no HEAD to baseline on
  check('a refused init (bad severity floor, unresolvable HEAD) exits 64 and creates no state directory', [refused, existsSync(path.join(bare, '.somi'))], [[64, 64], false]);
  rmSync(bare, { recursive: true, force: true });
}
{ // a repository the diff gate refuses is refused at init, before any coder pass; a plan loop has no diff gate
  const sub = mkdtempSync(path.join(tmpdir(), 'loop-initsub-'));
  const sg = (...a) => execFileSync('git', ['-C', sub, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  sg('init', '-q'); sg('commit', '-q', '--allow-empty', '-m', 'base');
  mkdirSync(path.join(sub, 'n')); execFileSync('git', ['-C', path.join(sub, 'n'), 'init', '-q']);
  const sctx = { root: sub, env: { SOMI_GLOBAL_CONFIG: '' }, stateDir: path.join(sub, '.somi', 'somi-state', 'loop'), now: () => '2026-01-01T00:00:00Z' };
  const code = init(sctx, { ...base, slug: 'x' });
  check('init in a repository with a nested repository is refused (64), names it with the .gitignore remedy, and writes nothing',
    [code.code, code.message.includes('does not support repositories with submodules (n/); if it is not a submodule, add it to .gitignore'), existsSync(path.join(sub, '.somi'))], [64, true, false]);
  check('a plan loop is not refused for a nested repository', init(sctx, { ...base, slug: 'p', loop: 'plan' }).code, 0);
  rmSync(sub, { recursive: true, force: true });
}
rmSync(root, { recursive: true, force: true });
rmSync(globalDir, { recursive: true, force: true });

console.log('== the snapshot tree is built from what is on disk, whatever the repository config says ==');
{ // each case: a committed baseline, one change, and what the measurement says about it
  const made = [];
  const repo = () => { const r = mkdtempSync(path.join(tmpdir(), 'loop-snap-')); made.push(r); const g = (...a) => execFileSync('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim(); g('init', '-q'); return { r, g }; };
  const put = (r, f, text, time) => { mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); writeFileSync(path.join(r, f), text); if (time) utimesSync(path.join(r, f), time, time); };
  const measure = (r, g) => treeNumstat(r, g('rev-parse', 'HEAD'), measuredTree(r));
  const refused = (r) => { const [a, code, msg] = exitOf(() => measuredTree(r)); return [a, code, msg.startsWith('somi-loop: cannot measure the diff: ')]; };
  const racy = repo(); put(racy.r, 'f', 'aaaa\n', 1700000000); racy.g('add', '.'); racy.g('commit', '-q', '-m', 'f');
  utimesSync(path.join(racy.r, '.git', 'index'), 1700000000, 1700000000); put(racy.r, 'f', 'bbbb\n', 1700000000); // same size, same second as the index: git calls the entry racy
  check('a same-size edit made in the second the index was written is counted (the throwaway index keeps the real index\'s times)', measure(racy.r, racy.g), [{ added: 1, deleted: 1, file: 'f' }]);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100); // git compares ctime to the second
  utimesSync(path.join(racy.r, '.git', 'index'), 1800000000, 1800000000); racy.g('config', 'core.trustctime', 'false'); racy.g('config', 'core.checkStat', 'minimal'); racy.g('config', 'core.ignoreStat', 'true'); put(racy.r, 'f', 'cccc\n', 1700000000); // the old mtime put back by hand
  check('a repository config that loosens the stat check does not hide a same-size edit that kept its old mtime', measure(racy.r, racy.g), [{ added: 1, deleted: 1, file: 'f' }]);
  const hook = path.join(racy.r, 'hook.sh'); put(racy.r, 'hook.sh', `#!/bin/sh\ntouch ${path.join(racy.r, 'RAN')}\nprintf '\\0'\n`); chmodSync(hook, 0o755); racy.g('config', 'core.fsmonitor', hook);
  check('a core.fsmonitor hook in the repository config does not run during the measurement', [measure(racy.r, racy.g).length, existsSync(path.join(racy.r, 'RAN'))], [2, false]);
  const rep = repo(); rep.g('commit', '-q', '--allow-empty', '-m', '0'); put(rep.r, 'f', 'x\n'.repeat(4000)); rep.g('add', '.'); rep.g('commit', '-q', '-m', 'f'); put(rep.r, 'one', 'x\n');
  rep.g('replace', rep.g('rev-parse', 'HEAD:f'), rep.g('hash-object', '-w', 'one'));
  check('a git replace ref is refused with 64, so a substituted blob is never counted in place of the real one', refused(rep.r), [true, 64, true]);
  check('and the diff itself ignores the replacement: the 4000 lines of the real blob, not the 1 of the substitute', treeNumstat(rep.r, rep.g('rev-parse', 'HEAD~1'), rep.g('rev-parse', 'HEAD'))[0].added, 4000);
  const sp = repo(); put(sp.r, 'src/a', 'a\n'); put(sp.r, 'other/b', 'b\n'); sp.g('add', '.'); sp.g('commit', '-q', '-m', 'f'); sp.g('sparse-checkout', 'set', '--cone', 'src'); put(sp.r, 'src/a', 'a\nb\n');
  check('a sparse checkout measures: files left out of the working tree are not an edit', [existsSync(path.join(sp.r, 'other')), measure(sp.r, sp.g)], [false, [{ added: 1, deleted: 0, file: 'src/a' }]]);
  sp.g('sparse-checkout', 'disable'); sp.g('update-index', '--skip-worktree', 'src/a'); // a hidden flag on a file that is on disk
  check('a skip-worktree file that is on disk refuses: its edit would be hidden', refused(sp.r), [true, 64, true]);
  const wt = repo(); wt.g('commit', '-q', '--allow-empty', '-m', 'f'); wt.g('config', 'extensions.worktreeConfig', 'true'); put(wt.r, '.gitattributes', '*.js filter=x\n'); put(wt.r, 'f.js', 'x\n');
  wt.g('config', '--worktree', 'filter.x.clean', `touch ${path.join(wt.r, 'RAN')}; cat`);
  check('a clean filter in the worktree config is refused and does not run', [...refused(wt.r), existsSync(path.join(wt.r, 'RAN'))], [true, 64, true, false]);
  const ign = repo(); put(ign.r, 'a', 'a\n'); ign.g('add', '.'); ign.g('commit', '-q', '-m', 'f'); put(ign.r, '.gitignore', '.somi\n'); put(ign.r, '.somi/n', 'x\n'.repeat(50)); put(ign.r, 'z', 'x\n');
  check('a .gitignore that ignores .somi does not stop the measurement, and .somi stays out of it', measure(ign.r, ign.g).map((x) => x.file).sort(), ['.gitignore', 'z']);
  const bin = repo(); bin.g('commit', '-q', '--allow-empty', '-m', 'f'); put(bin.r, 'b.bin', Buffer.alloc(4999));
  check('a binary with no newline counts one line per 50 bytes (100), not one', measure(bin.r, bin.g), [{ added: 100, deleted: 0, file: 'b.bin' }]);
  const wtr = repo(); put(wtr.r, 'f', 'a\n'); wtr.g('add', '.'); wtr.g('commit', '-q', '-m', 'f'); put(wtr.r, 'f', 'a\nb\nc\n');
  const empty = mkdtempSync(path.join(tmpdir(), 'loop-snap-')); made.push(empty); wtr.g('config', 'core.worktree', empty);
  check('a core.worktree that points elsewhere does not hide the real tree', measure(wtr.r, wtr.g), [{ added: 2, deleted: 0, file: 'f' }]);
  const decoy = repo(); const head = wtr.g('rev-parse', 'HEAD'); process.env.GIT_DIR = path.join(decoy.r, '.git'); process.env.GIT_INDEX_FILE = path.join(decoy.r, 'nope'); process.env.GIT_OBJECT_DIRECTORY = empty; process.env.GIT_LITERAL_PATHSPECS = '1';
  const viaEnv = treeNumstat(wtr.r, head, measuredTree(wtr.r)); delete process.env.GIT_DIR; delete process.env.GIT_INDEX_FILE; delete process.env.GIT_OBJECT_DIRECTORY; delete process.env.GIT_LITERAL_PATHSPECS;
  check('a GIT_DIR, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY and GIT_LITERAL_PATHSPECS in the caller\'s environment do not redirect the measurement', viaEnv, [{ added: 2, deleted: 0, file: 'f' }]);
  const sm = repo(); sm.g('commit', '-q', '--allow-empty', '-m', 'f'); put(sm.r, 'n/a', 'x\n'.repeat(50)); execFileSync('git', ['-C', path.join(sm.r, 'n'), 'init', '-q']); execFileSync('git', ['-C', path.join(sm.r, 'n'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.']); execFileSync('git', ['-C', path.join(sm.r, 'n'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'n']);
  put(sm.r, '.gitmodules', '[submodule "n"]\n\tpath = n\n\turl = ./n\n\tignore = all\n');
  check('a nested repository hidden by .gitmodules ignore = all is refused like any other', exitOf(() => measure(sm.r, sm.g)).slice(0, 2), [true, 64]);
  const hk = repo(); hk.g('commit', '-q', '--allow-empty', '-m', 'f'); put(hk.r, 'f', 'x\n'); put(hk.r, '.git/hooks/post-index-change', `#!/bin/sh\ntouch ${path.join(hk.r, 'RAN')}\n`); chmodSync(path.join(hk.r, '.git/hooks/post-index-change'), 0o755);
  check('a post-index-change hook does not run during the measurement', [measure(hk.r, hk.g).length, existsSync(path.join(hk.r, 'RAN'))], [1, false]);
  const sq = repo(); put(sq.r, 'src/a', 'a\n'); put(sq.r, 'other/b', 'b\n'); sq.g('add', '.'); sq.g('commit', '-q', '-m', 'f'); sq.g('sparse-checkout', 'set', '--cone', 'src'); put(sq.r, 'other/new', 'n\nn\n');
  check('an untracked file outside the sparse checkout is counted, not refused', measure(sq.r, sq.g), [{ added: 2, deleted: 0, file: 'other/new' }]);
  const sub = repo(); put(sub.r, 'pkg/a', 'a\nb\n'); put(sub.r, 'big', 'x\n'.repeat(2000)); sub.g('add', '.'); sub.g('commit', '-q', '-m', 'f'); put(sub.r, 'pkg/a', 'a\nB\n'); put(sub.r, 'big', 'y\n'.repeat(2000));
  const subRoot = path.join(sub.r, 'pkg'); const subDiff = computeDiff(subRoot, sub.g('rev-parse', 'HEAD'), ['a']);
  check('a project directory below the repository top level counts its own subtree: a one-line edit is 2 lines, none out of scope', [subDiff.total, subDiff.weighted, subDiff.outOfScope], [2, 2, []]);
  const lk = repo(); put(lk.r, 'f', 'a\n'); lk.g('add', '.'); lk.g('commit', '-q', '-m', 'f'); const lkDir = path.join(lk.r, '..', path.basename(lk.r) + '-wt'); made.push(lkDir); lk.g('worktree', 'add', '-q', lkDir, '-b', 'x'); put(lkDir, 'f', 'a\nb\n');
  check('a linked worktree measures its own files', measure(lkDir, lk.g), [{ added: 1, deleted: 0, file: 'f' }]);
  const ic = repo(); put(ic.r, 'foo.txt', 'a\n'); ic.g('add', '.'); ic.g('commit', '-q', '-m', 'f'); ic.g('config', 'core.ignoreCase', 'true'); put(ic.r, 'Foo.txt', 'x\n'.repeat(3000));
  check('core.ignoreCase true in the repository config does not hide a new file whose name differs from a tracked one only by case', measure(ic.r, ic.g), [{ added: 3000, deleted: 0, file: 'Foo.txt' }]);
  symlinkSync('.git', path.join(ic.r, '.GIT'));
  check('and a .GIT symlink to .git does not either: git refuses the path, so the measurement refuses rather than count less', refused(ic.r), [true, 64, true]);
  const initAt = (r) => init({ root: r, env: { SOMI_GLOBAL_CONFIG: '' }, stateDir: path.join(r, '.somi', 'somi-state', 'loop'), now: () => 'T' }, { ...base, slug: 'i' });
  const nameInvalid = exitOf(() => measuredTree(ic.r))[2];
  check('git\'s invalid path is named in the refusal, bounded and without control characters', [nameInvalid.includes('"/.GIT"') || nameInvalid.includes('".GIT"'), nameInvalid.includes("'")], [true, false]);
  const hl = repo(); put(hl.r, 'f', 'a\n'); hl.g('add', '.'); hl.g('commit', '-q', '-m', 'f'); const hlDir = path.join(hl.r, '..', path.basename(hl.r) + '-wt'); made.push(hlDir); hl.g('worktree', 'add', '-q', hlDir, '-b', 'x'); put(hlDir, 'f', 'a\nb\n'); linkSync(path.join(hlDir, '.git'), path.join(hlDir, '.GIT'));
  check('a hard-linked gitfile .GIT in a linked worktree is refused (64), never counted as no change', refused(hlDir), [true, 64, true]);
  const sg = (r, ...a) => execFileSync('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...a], { encoding: 'utf8' }).trim();
  for (const [what, plant] of [['an empty .git directory', (d) => mkdirSync(path.join(d, '.git'))], ['a gitfile that is not a gitdir line', (d) => writeFileSync(path.join(d, '.git'), 'hello\n')], ['a gitfile pointing at a directory that is no repository', (d) => writeFileSync(path.join(d, '.git'), `gitdir: ${tmpdir()}\n`)]]) {
    const pl = repo(); pl.g('commit', '-q', '--allow-empty', '-m', 'f'); put(pl.r, 'pkg/f', 'x\n'); plant(path.join(pl.r, 'pkg'));
    check(`${what} between the project and the top is refused (64) with the .git cause, not walked past`, [refused(path.join(pl.r, 'pkg')), exitOf(() => measuredTree(path.join(pl.r, 'pkg')))[2].includes('.git" is neither a git directory nor'), initAt(path.join(pl.r, 'pkg')).code], [[true, 64, true], true, 64]);
  }
  const home = repo(); put(home.r, 'pkg/f', 'a\n'); home.g('add', '.'); home.g('commit', '-q', '-m', 'f'); const link = path.join(path.dirname(home.r), path.basename(home.r) + '-link'); made.push(link); symlinkSync(path.join(home.r, 'pkg'), link); put(home.r, 'pkg/f', 'a\nb\n');
  check('a project directory reached through a symlink to a subdirectory is measured like the real path', [treeNumstat(link, home.g('rev-parse', 'HEAD'), measuredTree(link)), computeDiff(link, home.g('rev-parse', 'HEAD'), ['f']).weighted], [[{ added: 1, deleted: 0, file: 'f' }], 1]);
  const decoy2 = repo(); decoy2.g('commit', '-q', '--allow-empty', '-m', 'other'); process.env.GIT_DIR = path.join(decoy2.r, '.git'); process.env.GIT_WORK_TREE = decoy2.r;
  const atInit = initAt(home.r).out?.baseline_sha; delete process.env.GIT_DIR; delete process.env.GIT_WORK_TREE;
  check('the init baseline is the project\'s HEAD whatever GIT_DIR the caller\'s environment holds', atInit, home.g('rev-parse', 'HEAD'));
  const noHead = repo(); const refusedInit = initAt(noHead.r);
  check('init in a repository with no commit is a refusal (64) that names HEAD, with no state written', [refusedInit.code, refusedInit.message.startsWith('somi-loop: cannot resolve HEAD') && refusedInit.message.includes('no commit'), existsSync(path.join(noHead.r, '.somi'))], [64, true, false]);
  const deep = repo(); deep.g('commit', '-q', '--allow-empty', '-m', 'f'); const deepDir = path.join(deep.r, 'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)); mkdirSync(path.join(deepDir, '.git'), { recursive: true });
  check('a long path keeps its .git tail in the refusal', exitOf(() => measuredTree(deepDir))[2].includes('.git" is neither'), true);
  const gitfile = readFileSync(path.join(lkDir, '.git'), 'utf8').trim().slice('gitdir: '.length);
  writeFileSync(path.join(lkDir, '.git'), `gitdir: ${gitfile}\r\n\r\n`);
  check('a gitfile ending in CRLF and a blank line, as git reads it, is accepted', measure(lkDir, lk.g), [{ added: 1, deleted: 0, file: 'f' }]);
  const gf = repo(); gf.g('commit', '-q', '--allow-empty', '-m', 'f'); put(gf.r, 'pkg/f', 'x\n'); symlinkSync(path.join(lkDir, '.git'), path.join(gf.r, 'pkg', '.git'));
  check('a gitfile reached through a symlink is refused, not read', refused(path.join(gf.r, 'pkg')), [true, 64, true]);
  const fk = repo(); fk.g('commit', '-q', '--allow-empty', '-m', 'f'); put(fk.r, "x invalid path 'FAKE'", 'x\n'); chmodSync(path.join(fk.r, "x invalid path 'FAKE'"), 0);
  const fakeMsg = exitOf(() => measuredTree(fk.r))[2];
  check('a file name that contains git\'s invalid-path wording is not mistaken for it', [fakeMsg.startsWith('somi-loop: cannot measure the diff: '), fakeMsg.includes('refuses the path')], [true, false]);
  const nest = (r, rel) => { sg(r, 'init', '-q', rel); put(r, `${rel}/a`, 'x\n'); sg(path.join(r, rel), 'add', '.'); sg(path.join(r, rel), 'commit', '-q', '-m', 'n'); }; // a repository at r/rel
  const withSub = () => { const o = repo(); nest(o.r, '.'); const t = repo(); sg(t.r, 'submodule', 'add', '-q', o.r, 'n'); sg(t.r, 'commit', '-q', '-m', 't'); return t; }; // a committed submodule n
  const refusedAs = (r, where) => { const [a, code, msg] = exitOf(() => measuredTree(r)); return [a, code, msg.includes(`does not support repositories with submodules (${where})`)]; };
  const tmps = () => readdirSync(tmpdir()).filter((f) => f.startsWith('somi-tree-')).length;
  const indexOf = (r) => readFileSync(path.join(r, '.git', 'index')).toString('hex');
  const gl = repo(); gl.g('commit', '-q', '--allow-empty', '-m', 'f'); nest(gl.r, 'n'); sg(gl.r, 'add', 'n');
  check('a gitlink in the index is refused (64) with one message naming it', refusedAs(gl.r, 'n'), [true, 64, true]);
  const hd = withSub(); sg(hd.r, 'rm', '-q', '--cached', 'n'); rmSync(path.join(hd.r, 'n'), { recursive: true, force: true });
  check('a gitlink only in HEAD (git rm --cached, directory gone) is refused', refusedAs(hd.r, 'n'), [true, 64, true]);
  const ut = repo(); ut.g('commit', '-q', '--allow-empty', '-m', 'f'); nest(ut.r, 'd/e/inner');
  check('an untracked directory that holds a .git is refused, named with its path', refusedAs(ut.r, 'd/e/inner/'), [true, 64, true]);
  check('a gitlink refusal does not suggest .gitignore (only an untracked directory may be ignored)', [exitOf(() => measuredTree(gl.r))[2].includes('.gitignore'), exitOf(() => measuredTree(ut.r))[2].includes('add it to .gitignore')], [false, true]);
  const co = withSub(); put(co.r, 'n/a', 'x\ny\n'); put(co.r, 'f', 'z\n'); const idx = indexOf(co.r); const before = tmps();
  check('a checked-out submodule is refused whatever it holds, and the refusal writes nothing (index and temp directories as they were)', [refusedAs(co.r, 'n'), indexOf(co.r), tmps()], [[true, 64, true], idx, before]);
  const ig = repo(); ig.g('commit', '-q', '--allow-empty', '-m', 'f'); nest(ig.r, 'vendor'); put(ig.r, '.gitignore', 'vendor/\n'); put(ig.r, 'f', 'a\n');
  check('a nested repository that .gitignore lists is not a submodule: the rest is measured', measure(ig.r, ig.g).map((x) => x.file).sort(), ['.gitignore', 'f']);
  const so = repo(); so.g('commit', '-q', '--allow-empty', '-m', 'f'); nest(so.r, '.somi/x'); put(so.r, 'f', 'a\n');
  check('a repository under .somi is outside the measurement, not a submodule', measure(so.r, so.g), [{ added: 1, deleted: 0, file: 'f' }]);
  for (const r of made) rmSync(r, { recursive: true, force: true });
}

console.log(`loop engine tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
