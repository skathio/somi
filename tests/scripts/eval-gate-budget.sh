#!/usr/bin/env bash
# Pins the pre-registered budget (FR-0), the per-draw budget verdict (FR-7) and the gate-run envelope
# (FR-0b) in tests/evals/lib/budget.mjs, and the committed tests/evals/budget.json against them.
# Hermetic: pure computation, no model, network or credential, and it never reads .somi/ -- the opt-in
# tests/scripts/manual/budget-crosscheck.sh is the only thing that does. Skipped in a published tarball,
# where tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: budget pre-registration & envelope =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

out=$(node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { ARM_OUTCOMES, armVerdict } from './tests/evals/lib/rules.mjs';
import { PREREGISTERED, validateBudget, drawVerdictByBudget, envelopeStep } from './tests/evals/lib/budget.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const safe = (f) => { try { return f(); } catch { return 'THREW'; } };
const thrower = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });

// --- the table and the committed config ---------------------------------------------------------
const committed = JSON.parse(readFileSync('tests/evals/budget.json', 'utf8'));
const REGISTERED = ['perDrawUsd', 'perDrawMin', 'perRunUsd', 'perRunHours', 'runDraws', 'runConcurrent', 'phase1Usd', 'replacementSmokeUsd'];
check('PREREGISTERED is frozen', Object.isFrozen(PREREGISTERED), true);
check('PREREGISTERED: \$8 / 40 min per draw, \$144 / 4 h / 18 draws / 3 concurrent per run, \$208 phase, \$56 smoke', REGISTERED.map((k) => PREREGISTERED[k]), [8, 40, 144, 4, 18, 3, 208, 56]);
check('derived in-flight ceiling is \$168 = 144 + 3 x 8', PREREGISTERED.inFlightCeilingUsd, 168);
check('table is nine figures: eight registered plus the derived one', Object.keys(PREREGISTERED), [...REGISTERED, 'inFlightCeilingUsd']);
check('mutating the frozen table does not take effect', safe(() => { 'use strict'; PREREGISTERED.perDrawUsd = 9; return PREREGISTERED.perDrawUsd; }), 'THREW');
check('committed budget.json equals the table, same key order', committed, { ...PREREGISTERED });
check('committed budget.json validates', validateBudget(committed).verdict, 'valid');
check('valid result shape', Object.keys(validateBudget(committed)), ['verdict', 'rule_id', 'fields', 'reason']);

// --- validateBudget: refusal names the field ----------------------------------------------------
const cfg = (o = {}) => ({ ...committed, ...o });
const refusal = (c) => { const r = validateBudget(c); return [r.verdict, r.fields]; };
check('config absent (undefined, null) -> refused', [undefined, null].map(refusal), [['refused', ['config']], ['refused', ['config']]]);
check('config not an object (string, number, array, true) -> refused', ['x', 7, [], true].map((c) => refusal(c)[0]), Array(4).fill('refused'));
check('throwing config -> refused, not a throw', safe(() => refusal(thrower)), ['refused', ['config']]);
for (const key of REGISTERED) {
  check('mutated ' + key + ' (+1) -> refused naming only ' + key, refusal(cfg({ [key]: committed[key] + 1 })), ['refused', [key]]);
  check('mutated ' + key + ' (-1) -> refused naming only ' + key, refusal(cfg({ [key]: committed[key] - 1 })), ['refused', [key]]);
  check(key + ' as a string -> refused naming it', refusal(cfg({ [key]: String(committed[key]) })), ['refused', [key]]);
  const missing = cfg(); delete missing[key];
  check(key + ' missing -> refused naming it', refusal(missing), ['refused', [key]]);
}
check('derived ceiling edited (169, 167, 144) -> refused naming inFlightCeilingUsd', [169, 167, 144].map((v) => refusal(cfg({ inFlightCeilingUsd: v }))), Array(3).fill(['refused', ['inFlightCeilingUsd']]));
check('derived ceiling missing -> refused naming it', (() => { const c = cfg(); delete c.inFlightCeilingUsd; return refusal(c); })(), ['refused', ['inFlightCeilingUsd']]);
check('derived ceiling reason says it is derived', validateBudget(cfg({ inFlightCeilingUsd: 200 })).reason.includes('derived, not settable'), true);
check('perRunUsd raised with a matching ceiling is still refused (figure unequal)', refusal(cfg({ perRunUsd: 152, inFlightCeilingUsd: 176 })), ['refused', ['perRunUsd', 'inFlightCeilingUsd']]);
check('extra key -> refused naming it', refusal(cfg({ extra: 1 })), ['refused', ['extra']]);
check('a JSON __proto__ key is an extra key, not a prototype write', refusal(JSON.parse('{\"__proto__\": {\"perDrawUsd\": 8}, ' + JSON.stringify(committed).slice(1))), ['refused', ['__proto__']]);
check('NaN / Infinity / null / true figures -> refused', [NaN, Infinity, null, true].map((v) => refusal(cfg({ perDrawUsd: v }))), Array(4).fill(['refused', ['perDrawUsd']]));
check('several bad fields are all named', refusal(cfg({ perDrawUsd: 9, phase1Usd: 1, extra: 1 })), ['refused', ['perDrawUsd', 'phase1Usd', 'extra']]);
check('empty object -> refused naming all nine', validateBudget({}).fields.length, 9);
check('inherited figures do not count (prototype-only object) -> refused', refusal(Object.create(committed)), ['refused', Object.keys(committed)]);

// --- drawVerdictByBudget: strict > on both limits -----------------------------------------------
const draw = (o = {}) => drawVerdictByBudget({ costUsd: 3, durationMin: 10, ...o });
const dv = (o) => draw(o)?.verdict ?? null;
check('cost \$8.00 exactly -> within-budget', dv({ costUsd: 8 }), 'within-budget');
check('cost \$8.01 -> fail: over-budget', dv({ costUsd: 8.01 }), 'fail: over-budget');
check('cost \$7.99 -> within-budget', dv({ costUsd: 7.99 }), 'within-budget');
check('duration 40:00 exactly -> within-budget', dv({ durationMin: 40 }), 'within-budget');
check('duration 40:01 (40 + 1/60 min) -> fail: over-budget', dv({ durationMin: 40 + 1 / 60 }), 'fail: over-budget');
check('duration 39.99 -> within-budget', dv({ durationMin: 39.99 }), 'within-budget');
check('both over -> one verdict, both reasons', [dv({ costUsd: 9, durationMin: 41 }), draw({ costUsd: 9, durationMin: 41 }).reasons.length], ['fail: over-budget', 2]);
check('only duration over -> reason names the duration only', draw({ durationMin: 41 }).reason, 'duration 41 min > 40 min');
check('within reason carries the numbers', draw({ costUsd: 8, durationMin: 40 }).reason, 'cost \$8.00 <= \$8.00, duration 40 min <= 40 min');
check('draw result shape', Object.keys(draw()), ['verdict', 'rule_id', 'outcome', 'reasons', 'reason']);
const over = draw({ costUsd: 9 });
check('outcome: over-budget is an arm token, within-budget is null', [over.outcome, ARM_OUTCOMES.includes(over.outcome), draw().outcome], ['over-budget', true, null]);
check('armVerdict counts the over-budget token as a failure (4 of 9 fails the arm)', armVerdict([over.outcome, over.outcome, over.outcome, over.outcome, ...Array(5).fill('pass')])?.verdict, 'FAIL');
check('money is compared in whole cents (half-cent tolerance): \$8.004 is within, \$8.005 and \$8.006 are over', [dv({ costUsd: 8.004 }), dv({ costUsd: 8.005 }), dv({ costUsd: 8.006 })], ['within-budget', 'fail: over-budget', 'fail: over-budget']);
check('zero cost and duration are within budget (a draw may cost nothing)', dv({ costUsd: 0, durationMin: 0 }), 'within-budget');
check('draw: bad costUsd / durationMin (missing, NaN, Infinity, negative, string) -> null', ['costUsd', 'durationMin'].flatMap((f) => [undefined, NaN, Infinity, -1, '5'].map((v) => dv({ [f]: v }))), Array(10).fill(null));
check('draw: null / non-object / throwing input -> null', [drawVerdictByBudget(null), drawVerdictByBudget(undefined), drawVerdictByBudget('x'), safe(() => drawVerdictByBudget(thrower))], [null, null, null, null]);
let reads = 0;
const flipping = { durationMin: 10, get costUsd() { return reads++ === 0 ? 3 : 99; } };
check('draw: a getter is read once (3 is decided on, not 99)', [drawVerdictByBudget(flipping)?.verdict, reads], ['within-budget', 1]);

// --- envelopeStep -------------------------------------------------------------------------------
const H4 = 4 * 3600 * 1000;
const env = (o = {}) => envelopeStep({ draws: 5, invalidReplacements: 0, elapsedMs: 1000, spendUsd: 40, inFlight: 0, ...o });
const ev = (o) => env(o)?.verdict ?? null;
check('clean mid-run -> continue', ev(), 'continue');
check('the very first call of a run (everything 0) -> continue', ev({ draws: 0, invalidReplacements: 0, elapsedMs: 0, spendUsd: 0, inFlight: 0 }), 'continue');
check('continue reason says how many draws are needed of the 18 and how many are launched, not N/18 progress', [env().reason, ev({ draws: 16, invalidReplacements: 1, inFlight: 1 }) && env({ draws: 16, invalidReplacements: 1, inFlight: 1 }).reason], ['9 needed of 18 allowed, 5 launched, elapsed 1000 ms <= 14400000 ms, spend \$40.00 <= \$144.00', '18 needed of 18 allowed, 18 launched, elapsed 1000 ms <= 14400000 ms, spend \$40.00 <= \$144.00']);
check('continue carries the \$168 ceiling', env().ceilingUsd, 168);
check('envelope result shape', Object.keys(env()), ['verdict', 'rule_id', 'ceilingUsd', 'reasons', 'reason']);
// draws: valid + invalid + in flight, strictly more than 18.
check('10 invalid draws (9 valid done) -> abort: draws', env({ draws: 9, invalidReplacements: 10 }).verdict, 'abort: draws');
check('draws abort reason names the 18 ceiling', env({ draws: 9, invalidReplacements: 10 }).reason, '10 invalid + 9 valid (a verdict needs 9) = 19 draws > 18');
check('18 finished, 19th in flight -> abort: draws', ev({ draws: 17, invalidReplacements: 1, inFlight: 1 }), 'abort: draws');
check('17 finished + 1 in flight = 18 -> continue', ev({ draws: 16, invalidReplacements: 1, inFlight: 1 }), 'continue');
check('10 invalid, none valid: no verdict is possible -> abort: draws (also with 3 in flight)', [ev({ draws: 0, invalidReplacements: 10 }), ev({ draws: 0, invalidReplacements: 10, inFlight: 3 })], ['abort: draws', 'abort: draws']);
check('0 valid + 9 invalid -> continue (9 + 9 = 18); 9 valid + 9 invalid -> continue', [ev({ draws: 0, invalidReplacements: 9 }), ev({ draws: 9, invalidReplacements: 9 })], ['continue', 'continue']);
check('9 valid + 10 invalid -> abort: draws', ev({ draws: 9, invalidReplacements: 10 }), 'abort: draws');
// time: strictly more than 4 h.
check('elapsed 4 h exactly -> continue; 4 h + 1 ms -> abort: time', [ev({ elapsedMs: H4 }), ev({ elapsedMs: H4 + 1 })], ['continue', 'abort: time']);
check('time abort names the 4 h ceiling', env({ elapsedMs: H4 + 1 }).reason, 'elapsed 14400001 ms > 4 h (14400000 ms)');
// spend: cap \$144 with anything that could still spend; strictly over otherwise.
const sp = (spendUsd, o = {}) => env({ spendUsd, ...o });
check('\$144.00 with 3 in flight -> abort: spend', sp(144, { inFlight: 3 }).verdict, 'abort: spend');
check('spend abort reports the \$168 hard ceiling in reason and field', [sp(144, { inFlight: 3 }).reason.includes('hard ceiling \$168.00'), sp(144, { inFlight: 3 }).ceilingUsd], [true, 168]);
check('spend abort reason names the cap and in-flight count', sp(144, { inFlight: 3 }).reason, 'spend \$144.00 reached the \$144.00 cap with 3 in flight (hard ceiling \$168.00)');
check('\$143.99 with 3 in flight -> continue', sp(143.99, { inFlight: 3 }).verdict, 'continue');
check('\$144.00 with 1 in flight (also 17 valid + 1) -> abort: spend', [sp(144, { inFlight: 1 }).verdict, sp(144, { draws: 17, inFlight: 1 }).verdict], ['abort: spend', 'abort: spend']);
check('\$144.00, none in flight, draws still allowed -> abort: spend', sp(144, { draws: 9 }).verdict, 'abort: spend');
check('\$144.00, none in flight, all 18 done -> continue (nothing more can spend)', sp(144, { draws: 18 }).verdict, 'continue');
check('\$144.01, none in flight, all 18 done -> abort: spend (strictly over)', sp(144.01, { draws: 18 }).verdict, 'abort: spend');
let summed = 0; for (let i = 0; i < 1440; i++) summed += 0.1;
const noisy = 144.00000000000003; // one ulp above the cap
check('float noise above the cap (sums of 0.1) is not over: 144.00000000000003 is the cap, 143.99999999999613 is under', [noisy > 144, sp(noisy, { draws: 18 }).verdict, sp(summed, { draws: 18 }).verdict, sp(144.01, { draws: 18 }).verdict], [true, 'continue', 'continue', 'abort: spend']);
check('143.99999999999613 is the cap in cents: with a draw in flight it aborts', sp(summed, { inFlight: 1 }).verdict, 'abort: spend');
check('spend above the \$168 ceiling gets its own reason naming the invariant breach', [sp(168.01, { inFlight: 3 }).reasons[0].includes('past the hard ceiling \$168.00'), sp(168, { inFlight: 3 }).reasons[0].includes('past the hard ceiling')], [true, false]);
check('\$168 and \$168.01 (ceiling breach) with 3 in flight -> abort: spend', [sp(168, { inFlight: 3 }).verdict, sp(168.01, { inFlight: 3 }).verdict], ['abort: spend', 'abort: spend']);
// precedence and combinations.
const all3 = env({ draws: 9, invalidReplacements: 10, elapsedMs: H4 + 1, spendUsd: 150 });
check('all three triggers: draws is primary, all three listed in order', [all3.verdict, all3.reasons.map((r) => r.split(' ')[0])], ['abort: draws', ['10', 'elapsed', 'spend']]);
check('time + spend: time is primary', env({ elapsedMs: H4 + 1, spendUsd: 150 }).verdict, 'abort: time');
check('every abort carries the ceiling', [env({ draws: 9, invalidReplacements: 10 }), env({ elapsedMs: H4 + 1 }), sp(150)].map((r) => r.ceilingUsd), [168, 168, 168]);
// malformed -> null.
check('envelope: bad draws / invalidReplacements (missing, -1, 1.5, NaN, string) -> null', ['draws', 'invalidReplacements'].flatMap((f) => [undefined, -1, 1.5, NaN, '1'].map((v) => ev({ [f]: v }))), Array(10).fill(null));
check('envelope: bad elapsedMs / spendUsd (missing, -1, NaN, Infinity, string) -> null', ['elapsedMs', 'spendUsd'].flatMap((f) => [undefined, -1, NaN, Infinity, '1'].map((v) => ev({ [f]: v }))), Array(10).fill(null));
check('envelope: bad inFlight (missing, -1, 1.5, 4, string) -> null', [undefined, -1, 1.5, 4, '1'].map((v) => ev({ inFlight: v })), Array(5).fill(null));
check('envelope: null / undefined / throwing input -> null', [envelopeStep(null), envelopeStep(undefined), safe(() => envelopeStep(thrower))], [null, null, null]);
let r2 = 0;
const flipEnv = { draws: 5, invalidReplacements: 0, elapsedMs: 1000, inFlight: 0, get spendUsd() { return r2++ === 0 ? 40 : 500; } };
check('envelope: a getter is read once (40 is decided on, not 500)', [envelopeStep(flipEnv)?.verdict, r2], ['continue', 1]);

for (const [ok, name, got, want] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(want) + ', got ' + JSON.stringify(got) + ')'));
" 2>&1) || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# --- structural: npm test must not read .somi/, nor reach the manual cross-check --------------------
# Built from pieces so this file does not contain the strings it greps for.
manual="budget-cross""check"
chk() { # name, condition exit status
  if [ "$2" -eq 0 ]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"; else fail=$((fail+1)); printf '  FAIL %s\n' "$1"; fi
}
test_script=$(node -e "process.stdout.write(require('./package.json').scripts.test)")
reach=$( { printf '%s\n' "$test_script"; cat scripts/validate.sh; } | grep -c "$manual\|scripts/manual")
chk "nothing reachable from npm test names the manual cross-check or scripts/manual" "$([ "$reach" -eq 0 ]; echo $?)"
ls tests/scripts/eval-gate-*.sh | grep -q "$manual"; chk "the cross-check is outside the eval-gate-*.sh glob validate.sh runs" "$([ $? -ne 0 ]; echo $?)"
[ -x "tests/scripts/manual/$manual.sh" ]; chk "the cross-check script exists and is executable" $?
code=$(grep -v '^[[:space:]]*//' tests/evals/lib/budget.mjs)
printf '%s' "$code" | grep -q '\.somi'; chk "budget.mjs code does not name .somi" "$([ $? -ne 0 ]; echo $?)"
printf '%s' "$code" | grep -q "node:fs\|readFile"; chk "budget.mjs imports no filesystem access" "$([ $? -ne 0 ]; echo $?)"
grep -qx 'scripts/manual/' tests/.npmignore; chk "tests/.npmignore keeps scripts/manual/ out of the tarball" $?

ran=$((pass + fail))
[ "$ran" -ge 110 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 110 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
