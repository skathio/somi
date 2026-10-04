#!/usr/bin/env bash
# Pins paired triage (FR-35) and the one-rerun policy (FR-34) in tests/evals/lib/triage.mjs.
# Hermetic: pure computation, no model, network or credential. Skipped in a published tarball, where
# tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: paired triage & rerun policy =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

out=$(node --input-type=module -e "
import { triage, rerunAllowed, TRIAGE_RESULTS } from './tests/evals/lib/triage.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const safe = (f) => { try { return f(); } catch { return 'THREW'; } };

const arm = (fails, o = {}) => ({ outcomes: [...Array(fails).fill('fail'), ...Array(9 - fails).fill('pass')], cli: Array(9).fill('1.0.0'), models: Array(9).fill('m-a'), digest: 'tag-d', ...o });
const input = (o = {}) => ({ candidate: arm(5, { digest: 'cand-d' }), baseline: arm(1), tagBaselineDigest: 'tag-d', history: [], ...o });
const T = (o) => triage(input(o));
const v = (o) => T(o)?.verdict ?? null;
const rec = (o = {}) => ({ digest: 'd1', kind: 'verdict', triage_result: 'block', rerun_of: null, rerun_reason: null, ...o });
const rerun = (o = {}) => rec({ rerun_of: 'h0', rerun_reason: 'flaky runner', ...o });
const aborted = (c, o = {}) => rec({ kind: 'aborted', candidate_result: c, triage_result: undefined, ...o });
const INC = 'inconclusive: instrument-or-environment';
const mixed = (n, a, b) => [...Array(n).fill(a), ...Array(9 - n).fill(b)];

// FR-35 matrix.
check('C pass -> pass', v({ candidate: arm(3), baseline: null }), 'pass');
check('C fail, B pass -> block', v(), 'block');
check('C fail, B fail x1 -> inconclusive', v({ baseline: arm(4) }), INC);
check('x2 consecutive inconclusive -> user-decision-required', v({ baseline: arm(4), history: [rec({ triage_result: INC })] }), 'user-decision-required');
check('a block in between ends the streak -> inconclusive', v({ baseline: arm(4), history: [rec({ triage_result: INC }), rec({ triage_result: 'block' })] }), INC);
check('a pass in between ends the streak -> inconclusive', v({ baseline: arm(4), history: [rec({ triage_result: INC }), rec({ triage_result: 'pass' })] }), INC);
check('an aborted record in between does not end the streak', v({ baseline: arm(4), history: [rec({ triage_result: INC }), aborted('FAIL')] }), 'user-decision-required');
check('a refused record in between does not end the streak', v({ baseline: arm(4), history: [rec({ triage_result: INC }), rec({ triage_result: 'refused: drift' })] }), 'user-decision-required');
check('a streak is across digests', v({ baseline: arm(4), history: [rec({ digest: 'other', triage_result: INC })] }), 'user-decision-required');
check('a third in a row stays user-decision-required', v({ baseline: arm(4), history: [rec({ triage_result: INC }), rec({ triage_result: 'user-decision-required' })] }), 'user-decision-required');
check('an older inconclusive behind a block is not a streak', v({ baseline: arm(4), history: [rec({ triage_result: INC }), rec({ triage_result: 'block' })] }), INC);
check('a first block with inconclusive history is still a block', v({ history: [rec({ triage_result: INC })] }), 'block');
check('no tag (null, undefined) -> refused: no-baseline', [v({ tagBaselineDigest: null }), v({ tagBaselineDigest: undefined })], ['refused: no-baseline', 'refused: no-baseline']);
check('no tag and no baseline arm -> refused: no-baseline', v({ tagBaselineDigest: null, baseline: null }), 'refused: no-baseline');
check('baseline digest is not the tag digest -> refused: no-baseline', v({ tagBaselineDigest: 'other-d' }), 'refused: no-baseline');
check('candidate FAIL, tag present, no baseline arm yet -> null', [v({ baseline: null }), v({ baseline: undefined })], [null, null]);
check('candidate 9/9 pass with two cli versions -> refused: drift', v({ candidate: arm(0, { cli: mixed(8, '1.0.0', '1.0.1') }), baseline: null }), 'refused: drift');
check('candidate pass with two models -> refused: drift', v({ candidate: arm(0, { models: mixed(1, 'm-b', 'm-a') }), baseline: null }), 'refused: drift');
check('candidate FAIL with mixed cli inside the arm -> refused: drift', v({ candidate: arm(5, { cli: mixed(1, '1.0.1', '1.0.0') }) }), 'refused: drift');
check('between arms: cli mismatch -> refused: drift', v({ baseline: arm(1, { cli: Array(9).fill('1.0.1') }) }), 'refused: drift');
check('between arms: model mismatch -> refused: drift', v({ baseline: arm(1, { models: Array(9).fill('m-b') }) }), 'refused: drift');
check('uniform candidate + internally mixed baseline (cli) -> refused: drift', v({ baseline: arm(1, { cli: mixed(8, '1.0.0', '1.0.1') }) }), 'refused: drift');
check('uniform candidate + internally mixed baseline (models) -> refused: drift', v({ baseline: arm(1, { models: mixed(8, 'm-a', 'm-b') }) }), 'refused: drift');
check('mixed baseline that FAILs is still drift, not inconclusive', v({ baseline: arm(5, { models: mixed(4, 'm-b', 'm-a') }) }), 'refused: drift');
check('drift refusals never become a block, whatever the baseline outcome', [v({ baseline: arm(0, { cli: Array(9).fill('2') }) }), v({ baseline: arm(9, { cli: Array(9).fill('2') }) })], ['refused: drift', 'refused: drift']);

// Precedence, each step against the next (total order).
check('1 beats 2: candidate pass with drift is drift, not pass', v({ candidate: arm(0, { cli: mixed(1, 'x', '1.0.0') }) }), 'refused: drift');
check('2 beats 3: candidate pass with no tag is pass', v({ candidate: arm(3), tagBaselineDigest: null, baseline: null }), 'pass');
check('2 beats 4: candidate pass ignores a mismatched baseline', v({ candidate: arm(3), baseline: arm(1, { cli: Array(9).fill('9') }) }), 'pass');
check('3 beats 4: no-baseline wins over a cli mismatch', v({ tagBaselineDigest: 'other-d', baseline: arm(1, { cli: Array(9).fill('9') }) }), 'refused: no-baseline');
check('1 beats 3: candidate drift with no tag is drift', v({ candidate: arm(5, { models: mixed(1, 'x', 'm-a') }), tagBaselineDigest: null, baseline: null }), 'refused: drift');
check('4 beats 5: drift wins over a passing baseline and over a failing one', [v({ baseline: arm(0, { models: Array(9).fill('z') }) }), v({ baseline: arm(8, { models: Array(9).fill('z') }) })], ['refused: drift', 'refused: drift']);
check('4 beats the streak: drift with inconclusive history is drift', v({ baseline: arm(5, { cli: Array(9).fill('2') }), history: [rec({ triage_result: INC })] }), 'refused: drift');

// Arm threshold, by verdict on both sides (3/9 passes, 4/9 FAILs), and every failure kind counts.
check('candidate 3/9 failures -> pass; 4/9 -> not pass', [v({ candidate: arm(3), baseline: null }), v({ candidate: arm(4) })], ['pass', 'block']);
check('baseline 3/9 failures -> block; 4/9 -> inconclusive', [v({ baseline: arm(3) }), v({ baseline: arm(4) })], ['block', INC]);
check('over-budget and unexpected-pause count as failures', [v({ candidate: arm(0, { outcomes: [...Array(2).fill('over-budget'), ...Array(2).fill('unexpected-pause'), ...Array(5).fill('pass')] }) }), v({ baseline: arm(0, { outcomes: [...Array(2).fill('over-budget'), ...Array(2).fill('unexpected-pause'), ...Array(5).fill('pass')] }) })], ['block', INC]);

// Result shape and observability.
const r = T() ?? {};
check('result shape', Object.keys(r), ['verdict', 'rule_id', 'reason', 'candidate_failures', 'baseline_failures']);
check('result carries both arm counts and the reason', [r.candidate_failures, r.baseline_failures, r.reason], [5, 1, 'candidate FAILs and baseline passes (candidate 5/9 failures, baseline 1/9)']);
check('candidate pass without a baseline arm: baseline_failures null', T({ candidate: arm(0), baseline: null })?.baseline_failures, null);
check('TRIAGE_RESULTS is frozen and lists every verdict triage can emit', [Object.isFrozen(TRIAGE_RESULTS), TRIAGE_RESULTS.length], [true, 6]);

// FR-34 rerun policy.
const ra = (h, d = 'd1') => rerunAllowed(h, d)?.verdict ?? null;
check('no history -> allowed', ra([]), 'allowed');
check('first rerun not yet used (a plain verdict) -> allowed', ra([rec()]), 'allowed');
check('one reasoned rerun used -> second refused', ra([rec(), rerun()]), 'refused');
check('a second rerun on one digest is refused', ra([rec(), rerun(), rerun({ rerun_of: 'h1', rerun_reason: 'again' })]), 'refused');
check('a rerun on another digest does not consume this one', ra([rec(), rerun({ digest: 'd2' })]), 'allowed');
check('aborted after a candidate FAIL consumes the rerun', ra([rec(), aborted('FAIL')]), 'refused');
check('aborted with the candidate passing does not', ra([rec(), aborted('pass')]), 'allowed');
check('aborted with the candidate arm unknown does not', ra([aborted(null)]), 'allowed');
check('aborted after a FAIL on another digest does not', ra([aborted('FAIL', { digest: 'd2' })]), 'allowed');
check('an aborted rerun counts once, not twice', ra([rec(), aborted('FAIL', { rerun_of: 'h0', rerun_reason: 'r' })]), 'refused');
check('an aborted rerun with the arm unknown still used the rerun', ra([aborted(null, { rerun_of: 'h0', rerun_reason: 'r' })]), 'refused');
check('an unmarked repeat verdict uses the rerun: [block, block] -> refused', ra([rec(), rec()]), 'refused');
check('[block, block, block] -> refused', ra([rec(), rec(), rec()]), 'refused');
check('an aborted FAIL followed by an unmarked verdict -> refused', ra([aborted('FAIL'), rec()]), 'refused');
check('an aborted with the candidate passing, then a first verdict -> allowed', ra([aborted('pass'), rec()]), 'allowed');
check('a single first verdict is still allowed', ra([rec()]), 'allowed');
check('a marked rerun after a first verdict: allowed before it, refused after it', [ra([rec()]), ra([rec(), rerun()]), ra([rec(), rerun(), rec()])], ['allowed', 'refused', 'refused']);
check('another digest\'s repeat verdicts never count against this one', [ra([rec({ digest: 'd2' }), rec({ digest: 'd2' }), rec()]), ra([rec({ digest: 'd2' }), rec({ digest: 'd2' })], 'd2')], ['allowed', 'refused']);
check('rerunAllowed result shape', Object.keys(rerunAllowed([], 'd1') ?? {}), ['verdict', 'rule_id', 'reason']);

// Malformed shapes -> null, never a throw and never a verdict.
const thrower = new Proxy({}, { get() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } });
const sparse = (a) => { const c = a.slice(); delete c[4]; return c; };
const lenFlip = (arr, first, then) => { let c = 0; return new Proxy(arr, { get(t, k) { return k === 'length' ? (c++ === 0 ? first : then) : t[k]; } }); };
const flip = (field, first, then) => { let calls = 0; const o = arm(5); Object.defineProperty(o, field, { get() { return calls++ === 0 ? first : then; } }); return o; };
check('null / undefined / throwing / array / string input -> null', [safe(() => triage(null)), safe(() => triage(undefined)), safe(() => triage(thrower)), safe(() => triage([])), safe(() => triage('x'))], [null, null, null, null, null]);
check('missing / null / non-object candidate -> null', [undefined, null, 'x', []].map((c) => v({ candidate: c })), [null, null, null, null]);
check('non-object baseline (string, number, array) -> null', ['x', 1, []].map((b) => v({ baseline: b })), [null, null, null]);
check('sparse outcomes / cli / models -> null', [v({ candidate: arm(5, { outcomes: sparse(arm(5).outcomes) }) }), v({ candidate: arm(5, { cli: sparse(arm(5).cli) }) }), v({ candidate: arm(5, { models: sparse(arm(5).models) }) })], [null, null, null]);
check('sparse baseline arm -> null', v({ baseline: arm(1, { cli: sparse(arm(1).cli) }) }), null);
check('wrong lengths (8, 10; partial arm) -> null', [8, 10].map((n) => v({ candidate: arm(5, { outcomes: Array(n).fill('fail') }) })).concat([v({ candidate: arm(5, { cli: Array(8).fill('1.0.0') }) }), v({ candidate: arm(5, { models: Array(10).fill('m-a') }) }), v({ candidate: arm(5, { outcomes: [] }) })]), Array(5).fill(null));
check('non-enum outcomes (invalid, Pass, number) -> null', ['invalid', 'Pass', 1].map((o) => v({ candidate: arm(5, { outcomes: [o, ...arm(5).outcomes.slice(1)] }) })), [null, null, null]);
check('bad cli / models entries (empty, number, null, object) -> null', [['cli', ''], ['cli', 1], ['models', null], ['models', {}]].map(([f, x]) => v({ candidate: arm(5, { [f]: [x, ...Array(8).fill('q')] }) })), [null, null, null, null]);
check('bad arm digest (missing, empty, number) -> null', [undefined, '', 5].map((d) => v({ candidate: arm(5, { digest: d }) })), [null, null, null]);
check('bad tag (empty, number, object) -> null', ['', 5, {}].map((t) => v({ tagBaselineDigest: t })), [null, null, null]);
check('missing / non-array history -> null', [undefined, null, 'x', {}].map((h) => v({ history: h })), [null, null, null, null]);
check('Proxy outcomes with a throwing slot -> null', safe(() => v({ candidate: arm(5, { outcomes: new Proxy(arm(5).outcomes, { get(t, k, rr) { if (k === '2') throw new Error('boom'); return Reflect.get(t, k, rr); } }) }) })), null);
check('throwing candidate -> null', safe(() => v({ candidate: thrower })), null);
check('outcomes length read once: 9 then 10 decides on the one 9-slot copy; 10 then 9 -> null', [safe(() => v({ candidate: arm(5, { outcomes: lenFlip([...arm(5).outcomes, 'pass'], 9, 10) }) })), safe(() => v({ candidate: arm(5, { outcomes: lenFlip(arm(5).outcomes, 10, 9) }) }))], ['block', null]);
check('cli length reported 9 then 8 -> not a verdict from a short copy', safe(() => v({ candidate: arm(5, { cli: lenFlip(arm(5).cli, 9, 8) }) })), 'block');
check('history length read once: reported 1 then 0 still reads the one record', safe(() => v({ baseline: arm(4), history: lenFlip([rec({ triage_result: INC })], 1, 0) })), 'user-decision-required');
check('candidate pass cannot be reached by a flipping outcomes getter', safe(() => v({ candidate: flip('outcomes', arm(0).outcomes, arm(5).outcomes), baseline: arm(1) })), 'pass');
check('candidate FAIL stays FAIL when a getter flips afterwards', safe(() => v({ candidate: flip('outcomes', arm(5).outcomes, arm(0).outcomes) })), 'block');
check('cli getter drift-then-clean is read once: drift', safe(() => v({ candidate: flip('cli', mixed(1, 'x', '1.0.0'), arm(5).cli) })), 'refused: drift');
check('baseline outcomes getter FAIL-then-pass is read once: inconclusive', safe(() => v({ baseline: flip('outcomes', arm(5).outcomes, arm(0).outcomes) })), INC);
check('tag getter flipping match-then-mismatch is read once', safe(() => { let c = 0; const i = input(); Object.defineProperty(i, 'tagBaselineDigest', { get() { return c++ === 0 ? 'tag-d' : 'zzz'; } }); return triage(i)?.verdict; }), 'block');
check('inherited (prototype) fields are not read', safe(() => triage(Object.create(input()))), null);
check('inherited arm fields are not read', v({ candidate: Object.create(arm(5)) }), null);
check('bad history records -> null', [
  [{}], [null], ['x'], [rec({ digest: '' })], [rec({ kind: 'other' })], [rec({ triage_result: 'maybe' })], [rec({ triage_result: undefined })],
  [rec({ rerun_of: undefined })], [rec({ rerun_reason: undefined })], [rec({ rerun_of: undefined, rerun_reason: undefined })], [rec({ rerun_of: 'h0' })], [rec({ rerun_reason: 'why' })], [rec({ rerun_of: '', rerun_reason: '' })], [rec({ rerun_of: 5, rerun_reason: 'x' })],
  [aborted(undefined)], [aborted('fail')], [aborted(1)], new Array(1),
].map((h) => v({ history: h })), Array(18).fill(null));
check('sparse history -> null', v({ history: sparse([rec(), rec(), rec(), rec(), rec(), rec()]) }), null);
check('malformed history -> null even when the candidate passes', v({ candidate: arm(0), baseline: null, history: [{}] }), null);
check('rerunAllowed: bad history / digest / throwing -> null', [rerunAllowed(undefined, 'd1'), rerunAllowed([{}], 'd1'), rerunAllowed([rec({ rerun_of: 'h0' })], 'd1'), rerunAllowed([], ''), rerunAllowed([], undefined), rerunAllowed([], 5), safe(() => rerunAllowed(thrower, 'd1')), rerunAllowed(new Array(2), 'd1')], Array(8).fill(null));
check('rerunAllowed: a missing aborted candidate_result is not read as unused -> null', rerunAllowed([{ digest: 'd1', kind: 'aborted', rerun_of: null, rerun_reason: null }], 'd1'), null);
check('rerunAllowed: a flipping record getter is read once', safe(() => { let c = 0; const o = rec({ rerun_of: 'h0', rerun_reason: 'r' }); Object.defineProperty(o, 'rerun_of', { get() { return c++ === 0 ? 'h0' : null; } }); return rerunAllowed([o], 'd1')?.verdict; }), 'refused');

// NF2: each probability is a sum over arm failure counts of a test-local exact pmf times triage's
// verdict. The pmf is deliberately NOT imported from stats.mjs. The plan quotes 0.826% / 3.278% and
// 3.342% (+-0.05 pt); the exact values are computed here and pinned at 5e-4.
const choose = [1];
for (let n = 1; n <= 9; n++) { const prev = choose.slice(); for (let k = 1; k < n; k++) choose[k] = prev[k - 1] + prev[k]; choose[n] = 1; }
const pmf = (k, pPass) => choose[k] * (1 - pPass) ** k * pPass ** (9 - k);
// pCand / pBase are per-draw pass probabilities. 'Not blocked' is the candidate passing or both arms
// FAILing (inconclusive), per statistical-design section 6: pass or inconclusive, nothing else.
const pOf = (pCand, pBase, want) => { let s = 0; for (let k = 0; k <= 9; k++) for (let j = 0; j <= 9; j++) { if (want(triage(input({ candidate: arm(k, { digest: 'c' }), baseline: arm(j) }))?.verdict)) s += pmf(k, pCand) * pmf(j, pBase); } return s; };
const isBlock = (x) => x === 'block';
const notBlocked = (x) => x === 'pass' || x === INC;
const near = (got, want) => Math.abs(got - want) <= 0.0005;
const F = (p) => { let s = 0; for (let k = 4; k <= 9; k++) s += pmf(k, p); return s; };
check('P(block) at p=0.90 is 0.826% +-0.05 pt (via triage)', near(pOf(0.90, 0.90, isBlock), 0.00826), true);
check('P(block) at p=0.85 is 3.278% +-0.05 pt (via triage)', near(pOf(0.85, 0.85, isBlock), 0.03278), true);
check('P(not blocked) at q=0.3, p=0.90 is 3.342% +-0.05 pt (via triage)', near(pOf(0.3, 0.90, notBlocked), 0.03342), true);
check('enumeration agrees with F(p)(1-F(p)) and (1-F(q)) + F(q)F(p)', [near(pOf(0.90, 0.90, isBlock), F(0.90) * (1 - F(0.90))), near(pOf(0.3, 0.90, notBlocked), 1 - F(0.3) + F(0.3) * F(0.90))], [true, true]);
check('exact P(block) at p=0.90 is 0.008262 (6 d.p.)', pOf(0.90, 0.90, isBlock).toFixed(6), '0.008262');
check('exact P(block) at p=0.85 is 0.032780 (6 d.p.)', pOf(0.85, 0.85, isBlock).toFixed(6), '0.032780');
check('exact P(not blocked) at q=0.3, p=0.90 is 0.033415 (6 d.p.)', pOf(0.3, 0.90, notBlocked).toFixed(6), '0.033415');
check('every enumerated verdict is block, inconclusive or pass (no user-decision/drift in an empty history)', [...Array(10).keys()].every((k) => [...Array(10).keys()].every((j) => ['pass', 'block', INC].includes(triage(input({ candidate: arm(k), baseline: arm(j) }))?.verdict))), true);

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
[ "$ran" -ge 95 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 95 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
