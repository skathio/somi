#!/usr/bin/env node
// In-process tests of the loop engine libraries: scripts/lib/loop-caps.mjs and scripts/lib/loop-exit.mjs.
// Invoked from tests/scripts/loop-engine.sh.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCapOverride, configVal, firstDefined, resolveInitCap, reresolveCap, validateCap } from '../../../scripts/lib/loop-caps.mjs';
import { LoopExit, ok, refuse, usageError } from '../../../scripts/lib/loop-exit.mjs';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'lib');
let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
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
const sources = ['loop-caps.mjs', 'loop-exit.mjs'].map((f) => [f, readFileSync(path.join(LIB, f), 'utf8')]);
for (const [f, src] of sources) {
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  check(`${f} has no process.env outside comments`, /process\.env/.test(code), false);
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

console.log(`loop engine tests: ${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
