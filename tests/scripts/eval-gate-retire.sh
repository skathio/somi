#!/usr/bin/env bash
# Pins the eval gate's smoke admission, retire rule and rolling feed (tests/evals/lib/{rules,retire}.mjs)
# to the published tables (statistical-design.md sections 4-5, FR-14, FR-30). Hermetic: pure
# computation, no model, network or credential. Skipped in a published tarball, where tests/evals is
# absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: smoke admission, retirement & rolling feed =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

out=$(node --input-type=module -e "
import { smokeAdmit } from './tests/evals/lib/rules.mjs';
import { retireDecision, rollingFeed } from './tests/evals/lib/retire.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const outs = (fails, n, filler = 'fail') => [...Array(fails).fill(filler), ...Array(n - fails).fill('pass')];
const D = 'sha-released';
const draws = (fails, n, digest = D) => outs(fails, n).map((outcome) => ({ digest, outcome }));
const smoke = (fails, stage0 = false, filler = 'fail') => smokeAdmit(outs(fails, 5, filler), { stage0 });

// NF2: the weights are a test-local pmf (float Pascal's triangle, exact integer coefficients), NOT
// imported from stats.mjs, so a bug in the lib cannot also corrupt the reference it is judged by.
const pmf = (k, n, pFail) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c * pFail ** k * (1 - pFail) ** (n - k);
};
const pAdmit = (pPass) => { let t = 0; for (let k = 0; k <= 5; k++) if (smoke(k)?.verdict === 'admit') t += pmf(k, 5, 1 - pPass); return t; };
// The exact values are 0.91854 and 0.52822: the published 0.92 / 0.53 are 2-d.p. roundings of them,
// so those are pinned at the header tolerance +-0.0005 (an off-by-one threshold lands at 0.59 / 0.99).
for (const [p, want, tol] of [[0.90, 0.9185, 0.0005], [0.70, 0.5282, 0.0005], [0.3426, 0.05, 0.001]]) {
  const got = pAdmit(p);
  res.push([Math.abs(got - want) <= tol, 'P(admit) at p=' + p + ' is ' + want + ' +-' + tol, got.toFixed(4), want]);
}
const pRetire = (pPass) => { let t = 0; for (let k = 0; k <= 20; k++) if (retireDecision(draws(k, 20))?.verdict === 'retire') t += 100 * pmf(k, 20, 1 - pPass); return t; };
for (const [p, want] of [[0.90, 0.24], [0.80, 8.67], [0.70, 39.2]]) {
  const got = pRetire(p);
  res.push([Math.abs(got - want) <= 0.05, 'P(retire) at p=' + p + ' is ' + want + '% +-0.05pt', got.toFixed(3), want]);
}

// FR-14
check('4/5, no Stage 0 -> admitted', smoke(1)?.verdict, 'admit');
check('4/5 with Stage 0 -> rejected', smoke(1, true)?.verdict, 'reject');
check('5/5 with Stage 0 -> rejected', smoke(0, true)?.verdict, 'reject');
check('3/5 -> rejected', smoke(2)?.verdict, 'reject');
check('5/5 -> admitted with the numbers in the reason', smoke(0), { verdict: 'admit', rule_id: 'smoke-5-1', reason: '0/5 failures <= 1, no Stage 0' });
check('over-budget counts as a failure (2 -> rejected, 1 -> admitted)', [smoke(2, false, 'over-budget')?.verdict, smoke(1, false, 'over-budget')?.verdict], ['reject', 'admit']);
check('unexpected-pause counts as a failure', smoke(2, false, 'unexpected-pause')?.verdict, 'reject');
check('6 draws -> null', smokeAdmit(outs(0, 6), { stage0: false }), null);
check('4 draws -> null', smokeAdmit(outs(0, 4), { stage0: false }), null);
check('non-enum / invalid outcome -> null', [smokeAdmit(['Pass', ...outs(0, 4)], { stage0: false }), smokeAdmit(['invalid', ...outs(0, 4)], { stage0: false })], [null, null]);
check('stage0 missing or non-boolean -> null (absence is not a clean run)', [smokeAdmit(outs(0, 5)), smokeAdmit(outs(0, 5), {}), smokeAdmit(outs(0, 5), { stage0: 'false' }), smokeAdmit(outs(0, 5), { stage0: 0 })], [null, null, null, null]);
const holes5 = new Array(5); holes5[0] = 'fail';
const del5 = outs(0, 5); delete del5[2];
check('sparse arrays (new Array(5), a hole in a full array) -> null', [smokeAdmit(new Array(5), { stage0: false }), smokeAdmit(holes5, { stage0: false }), smokeAdmit(del5, { stage0: false })], [null, null, null]);
check('non-array -> null', [smokeAdmit(undefined, { stage0: false }), smokeAdmit('ppppp', { stage0: false }), smokeAdmit(null, { stage0: false })], [null, null, null]);
const thrower = new Proxy(outs(0, 5), { get(t, k, r) { if (k === '2') throw new Error('boom'); return Reflect.get(t, k, r); } });
const throwingOpts = new Proxy({}, { get() { throw new Error('boom'); } });
const getterOpts = { get stage0() { throw new Error('boom'); } };
const noThrow = (f) => { try { return f(); } catch { return 'THREW'; } };
check('null options -> null, not a throw', noThrow(() => smokeAdmit(outs(0, 5), null)), null);
check('a throwing-Proxy options object -> null, not a throw', noThrow(() => smokeAdmit(outs(0, 5), throwingOpts)), null);
check('a throwing stage0 getter -> null, not a throw', noThrow(() => smokeAdmit(outs(0, 5), getterOpts)), null);
check('a throwing Proxy getter -> null, not a throw', (() => { try { return smokeAdmit(thrower, { stage0: false }); } catch { return 'THREW'; } })(), null);

// FR-30
check('13/20 passing (7 failures) -> retire', retireDecision(draws(7, 20))?.verdict, 'retire');
check('14/20 passing (6 failures) -> kept', retireDecision(draws(6, 20))?.verdict, 'kept');
const r13 = retireDecision(draws(7, 20));
check('reason carries k, n and the upper bound', [r13.k, r13.n, r13.upper.toFixed(3), r13.reason], [7, 20, '0.819', '7/20 failures, Wilson upper 0.819 < 0.85']);
check('retire counts over-budget / unexpected-pause as failures', retireDecision([...Array(4).fill('over-budget'), ...Array(3).fill('unexpected-pause'), ...Array(13).fill('pass')].map((outcome) => ({ digest: D, outcome })))?.verdict, 'retire');
// Residual: on the n = 10..20 Wilson lattice every threshold in (0.84834, 0.85452] gives the same
// verdicts as 0.85 (nearest points 4/11 and 6/20), so only the reason string above names 0.85 itself.
check('mid-window boundary: 4/11 retires (upper 0.848), 4/12 kept (0.862)', [retireDecision(draws(4, 11))?.verdict, retireDecision(draws(4, 12))?.verdict], ['retire', 'kept']);
check('retire result carries rule_id', retireDecision(draws(7, 20))?.rule_id, 'wilson-20-0.85');
check('9 draws -> kept, insufficient (even all failures)', retireDecision(draws(9, 9)), { verdict: 'kept', rule_id: 'wilson-20-0.85', reason: 'insufficient: 9 valid draws < 10', k: 9, n: 9, upper: null });
check('0 draws -> kept, insufficient', retireDecision([])?.verdict, 'kept');
check('10 all-fail draws -> retire (the 10-draw minimum applies the rule)', retireDecision(draws(10, 10))?.verdict, 'retire');
check('10 draws, 3 failures -> kept; the 10..19 window is all draws', [retireDecision(draws(3, 10))?.verdict, retireDecision(draws(3, 10))?.n], ['kept', 10]);
// The window slides: 7 old failures fall out as 20 fresh passes arrive; fresh failures push a clean history over.
const old = draws(7, 20);
check('window slides: 7 failures then 20 passes -> kept, n=20', [retireDecision([...old, ...draws(0, 20)])?.verdict, retireDecision([...old, ...draws(0, 20)])?.n], ['kept', 20]);
check('window slides: 20 passes then 7 failures -> retire (a 27-draw record)', retireDecision([...draws(0, 20), ...Array(7).fill({ digest: D, outcome: 'fail' })])?.verdict, 'retire');
check('window is the LAST 20: an old failure beyond it is not counted', retireDecision([{ digest: D, outcome: 'fail' }, ...draws(6, 20)])?.k, 6);
check('malformed records -> null', [retireDecision([{ digest: D, outcome: 'invalid' }]), retireDecision([{ digest: '', outcome: 'pass' }]), retireDecision([{ outcome: 'pass' }]), retireDecision([null]), retireDecision(['pass'])], [null, null, null, null, null]);
check('malformed enum in a long record -> null, not a silent drop', retireDecision([...draws(0, 20), { digest: D, outcome: 'Pass' }]), null);
const holes = new Array(12); for (let i = 0; i < 12; i++) holes[i] = { digest: D, outcome: 'pass' }; delete holes[4];
check('sparse draws / non-array / wrong length shape -> null', [retireDecision(new Array(20)), retireDecision(holes), retireDecision(undefined), retireDecision('x'), retireDecision({ length: 20 })], [null, null, null, null, null]);

// FR-30 / F-49: rolling feed
const mixed = [{ digest: 'A', outcome: 'pass' }, { digest: 'B', outcome: 'fail' }, { digest: 'A', outcome: 'fail' }, { digest: 'C', outcome: 'pass' }];
check('a draw on an unreleased digest is absent', rollingFeed(mixed, new Set(['A', 'C'])).map((d) => d.digest + d.outcome), ['Apass', 'Afail', 'Cpass']);
check('releasedDigests may be an array; order is preserved', rollingFeed(mixed, ['C', 'A']).map((d) => d.digest), ['A', 'A', 'C']);
check('no released digest -> empty feed', rollingFeed(mixed, new Set()), []);
check('no draws -> empty feed', rollingFeed([], new Set(['A'])), []);
check('an unreleased failing candidate cannot retire a task: filtered feed is kept', retireDecision(rollingFeed([...draws(0, 12, 'rel'), ...draws(8, 8, 'cand')], new Set(['rel']))).verdict, 'kept');
check('the same draws UNFILTERED would retire (the filter is what guards)', retireDecision([...draws(0, 12, 'rel'), ...draws(8, 8, 'cand')]).verdict, 'retire');
check('rollingFeed malformed draws / digests -> null', [rollingFeed([{ digest: 'A', outcome: 'x' }], ['A']), rollingFeed(mixed, [1]), rollingFeed(mixed, ['']), rollingFeed(mixed, undefined), rollingFeed(mixed, 'A'), rollingFeed(undefined, ['A']), rollingFeed(new Array(2), ['A']), rollingFeed(mixed, new Array(2))], [null, null, null, null, null, null, null, null]);

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
