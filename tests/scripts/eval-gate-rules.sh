#!/usr/bin/env bash
# Pins the eval gate's pooled arm rule and statistics core (tests/evals/lib/{rules,stats}.mjs) to
# the published tables. Hermetic: pure computation, no model, network or credential. Skipped in a
# published tarball, where tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: pooled arm rule & statistics =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

out=$(node --input-type=module -e "
import { armVerdict, ARM_OUTCOMES, FAIL_OUTCOMES } from './tests/evals/lib/rules.mjs';
import { wilson, binomPmf, binomTailGE } from './tests/evals/lib/stats.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const arm = (fails, filler = 'fail') => [...Array(fails).fill(filler), ...Array(9 - fails).fill('pass')];

// NF2: P(arm FAIL | p) = sum over failure counts k of pmf(k) * [armVerdict says FAIL]. The pmf is
// written out here (float Pascal's triangle: exact integer coefficients, error ~1e-15 against the
// 5e-4 tolerance, so no BigInt) and deliberately NOT imported from stats.mjs, so a bug in the lib's pmf cannot
// also corrupt the reference it is judged against. Order-invariant rule => a canonical vector per k.
const choose = [1];
for (let n = 1; n <= 9; n++) { const prev = choose.slice(); for (let k = 1; k < n; k++) choose[k] = prev[k - 1] + prev[k]; choose[n] = 1; }
const pmf = (k, pPass) => choose[k] * (1 - pPass) ** k * pPass ** (9 - k);
const published = { 0.95: 0.06, 0.90: 0.83, 0.85: 3.39, 0.80: 8.56, 0.75: 16.6, 0.70: 27.0, 0.60: 51.7 };
for (const [p, want] of Object.entries(published)) {
  let pct = 0;
  for (let k = 0; k <= 9; k++) if (armVerdict(arm(k))?.verdict === 'FAIL') pct += 100 * pmf(k, Number(p));
  res.push([Math.abs(pct - want) <= 0.05, 'P(arm FAIL) at p=' + p + ' is ' + want + '% +-0.05pt', pct.toFixed(3), want]);
}

check('3 failures pass', armVerdict(arm(3)), { verdict: 'pass', rule_id: 'pooled-9-4', reason: '3/9 failures < 4' });
check('4 failures FAIL', armVerdict(arm(4)), { verdict: 'FAIL', rule_id: 'pooled-9-4', reason: '4/9 failures >= 4' });
check('over-budget counts as a failure', armVerdict(arm(4, 'over-budget'))?.verdict, 'FAIL');
check('3 over-budget do not FAIL', armVerdict(arm(3, 'over-budget'))?.verdict, 'pass');
check('8 entries -> null', armVerdict(arm(0).slice(1)), null);
check('10 entries -> null', armVerdict([...arm(0), 'pass']), null);
check('non-enum entry -> null', armVerdict([...arm(3), 'Pass'].slice(1)), null);
check('invalid entry -> null (caller replaces it)', armVerdict(['invalid', ...arm(0).slice(1)]), null);
// F-92: every slot must be PRESENT. Holes are skipped by every/filter and would read as a pass.
const holes = (fails) => { const a = new Array(9); for (let i = 0; i < fails; i++) a[i] = 'fail'; return a; };
const deleted = arm(0); for (const i of [1, 3, 5, 7]) delete deleted[i];
const thrower = new Proxy(arm(0), { get(t, k, r) { if (k === '2') throw new Error('boom'); return Reflect.get(t, k, r); } });
check('new Array(9) -> null', armVerdict(new Array(9)), null);
check('3 fails + 6 holes (length 9) -> null', armVerdict(holes(3)), null);
check('4 entries deleted from a full arm -> null', armVerdict(deleted), null);
check('a throwing Proxy getter -> null, not a throw', (() => { try { return armVerdict(thrower); } catch { return 'THREW'; } })(), null);
for (let i = 0; i < 9; i++) Array.prototype[i] = 'pass';
try { check('Array.prototype index pollution does not fill holes with passes', armVerdict(new Array(9)), null); }
finally { for (let i = 0; i < 9; i++) delete Array.prototype[i]; }

// F-93: the exported vocabulary is what armVerdict accepts; every non-pass token is a failure.
check('ARM_OUTCOMES is frozen', [Object.isFrozen(ARM_OUTCOMES), Object.isFrozen(FAIL_OUTCOMES)], [true, true]);
check('every ARM_OUTCOMES token is accepted; FAIL_OUTCOMES are exactly the failures',
  ARM_OUTCOMES.map((t) => armVerdict([t, ...arm(0).slice(1)])?.reason.slice(0, 3)).join(),
  ARM_OUTCOMES.map((t) => (FAIL_OUTCOMES.includes(t) ? '1/9' : '0/9')).join());
check('unexpected-pause counts as a failure', armVerdict(arm(4, 'unexpected-pause'))?.verdict, 'FAIL');
check('FAIL_OUTCOMES is ARM_OUTCOMES minus pass', FAIL_OUTCOMES.join(), ARM_OUTCOMES.filter((t) => t !== 'pass').join());
check('non-array -> null', [armVerdict(undefined), armVerdict(null), armVerdict('x'.repeat(9))], [null, null, null]);

// The lib's own pmf/tail are judged against the test-local reference, not the reverse.
const worst = Math.max(...[0, 3, 4, 9].map((k) => Math.abs(binomPmf(k, 9, 0.3) - pmf(k, 0.7))));
check('binomPmf matches the local reference (n=9, p_fail=0.3)', worst < 1e-12, true);
check('binomPmf(9 of 8) is 0, not NaN', binomPmf(9, 8, 0.5), 0);
check('binomTailGE(4,9,0.3) = P(arm FAIL | p=0.7) = 27.0%', (100 * binomTailGE(4, 9, 0.3)).toFixed(1), '27.0');
check('binomTailGE(0,n,p) = 1', Math.abs(binomTailGE(0, 9, 0.3) - 1) < 1e-12, true);

const w = wilson(13, 20);
check('wilson(13,20).upper = 0.819 (3 d.p.)', w && w.upper.toFixed(3), '0.819');
check('wilson(7,20).lower = 0.181 (symmetry)', wilson(7, 20).lower.toFixed(3), '0.181');
check('wilson(0,0) -> null', wilson(0, 0), null);
check('wilson(n,n).upper is exactly 1', [wilson(9, 9).upper, wilson(1, 1).upper], [1, 1]);
check('wilson(9,9) = [0.7008, 1]', wilson(9, 9).lower.toFixed(4), '0.7008');
check('wilson k>n -> null', wilson(6, 5), null);
check('wilson negative k -> null', wilson(-1, 5), null);
check('wilson non-integer k or n -> null', [wilson(2.5, 5), wilson(2, 5.5)], [null, null]);
check('wilson z NaN / 0 / negative / Infinity -> null', [NaN, 0, -1.96, Infinity].map((z) => wilson(1, 5, z)), [null, null, null, null]);
check('binomPmf non-integer k or n -> null', [binomPmf(3.5, 9, 0.3), binomPmf(3, 9.5, 0.3)], [null, null]);
check('binomPmf p outside [0,1] or NaN -> null', [binomPmf(3, 9, 1.5), binomPmf(3, 9, -0.1), binomPmf(3, 9, NaN)], [null, null, null]);
check('binomPmf k outside 0..n is a valid zero probability', [binomPmf(-1, 9, 0.3), binomPmf(10, 9, 0.3)], [0, 0]);
check('binomPmf at p=0 (0**0 = 1) and p=1', [binomPmf(0, 9, 0), binomPmf(1, 9, 0), binomPmf(9, 9, 1), binomPmf(8, 9, 1)], [1, 0, 1, 0]);
check('binomTailGE non-integer k -> null (not a silent 0)', binomTailGE(3.5, 9, 0.3), null);
check('binomTailGE p out of range -> null', binomTailGE(3, 9, 1.5), null);
check('binomTailGE(10,9,p) is 0', binomTailGE(10, 9, 0.3), 0);
check('wilson(0,5).lower is exactly 0', wilson(0, 5).lower, 0);

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
ran=$((pass + fail))
[ "$ran" -ge 46 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 46 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
