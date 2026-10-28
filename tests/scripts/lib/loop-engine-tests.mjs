#!/usr/bin/env node
// In-process tests of the loop engine libraries: scripts/lib/loop-caps.mjs, loop-exit.mjs, loop-state.mjs and
// loop-engine.mjs (the lifecycle, measuring and recording handlers).
// Invoked from tests/scripts/loop-engine.sh.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { applyCapOverride, configVal, firstDefined, resolveInitCap, reresolveCap, validateCap } from '../../../scripts/lib/loop-caps.mjs';
import { checkDiff, finish, init, pass as passPass, recordDispatch, recordPass, resume, reviewScope, runStart } from '../../../scripts/lib/loop-engine.mjs';
import { stateFile } from '../../../scripts/lib/loop-state.mjs';
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
rmSync(root, { recursive: true, force: true });
rmSync(globalDir, { recursive: true, force: true });

console.log(`loop engine tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
