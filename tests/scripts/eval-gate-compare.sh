#!/usr/bin/env bash
# Pins the SoMi-versus-bare comparison rule (tests/evals/lib/compare.mjs) to the pre-registered text: the exact
# sign test through the decision function against a test-local pmf, every verdict rule and its precedence, the
# exclusion and paused-arm accounting, and refusal of hostile input. Each rule is then mutated on a scratch copy
# of the library and the suite must fail. Hermetic: pure computation; no model, network, git or credential.
# Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: A/B comparison rule =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t cmp.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
const { compareArms: C, RULE } = await import(`${process.env.LIB}/compare.mjs`);
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const arm = (green, total = 4, outcome = 'scored', cost) => (cost === undefined ? { green, total, outcome } : { green, total, outcome, cost });
const pair = (i, somi, bare) => ({ task: `t${i}`, somi, bare });
const run = (list) => list.map(([s, b], i) => pair(i, s, b));
const WIN = [arm(2), arm(0)]; const LOSS = [arm(0), arm(2)]; const TIE = [arm(1), arm(1)];
const vs = (r) => (r === null ? null : r.verdict);
const keep = (r) => r && [r.verdict, r.wins, r.losses, r.ties, r.n, r.p];

check('the registered constants are frozen at the pre-registered values', [Object.isFrozen(RULE), { ...RULE }], [true, { ALPHA: 0.05, MIN_MEAN_DIFF: 0.1, EARLY_STOP_PAIRS: 3, CEILING_SHARE: 0.5 }]);
// Sign test, through the decision function. Pins from the registration: 6/6 0.03125, 5/6 0.21875, 4/4 0.125, 5/5 0.0625.
check('6 wins of 6: somi-better, p 0.03125', keep(C(run(Array(6).fill(WIN)))), ['somi-better', 6, 0, 0, 6, 0.03125]);
check('5 wins and 1 loss: inconclusive, p 0.21875', keep(C(run([...Array(5).fill(WIN), LOSS]))), ['inconclusive', 5, 1, 0, 6, 0.21875]);
check('5 wins and 1 tie: p 0.0625 is above alpha, inconclusive', keep(C(run([...Array(5).fill(WIN), TIE]))), ['inconclusive', 5, 0, 1, 6, 0.0625]);
check('4 non-tie wins and 2 ties: p 0.125, inconclusive', keep(C(run([TIE, ...Array(4).fill(WIN), TIE]))), ['inconclusive', 4, 0, 2, 6, 0.125]);
check('6 losses of 6: bare-better (symmetric), p 0.03125', keep(C(run(Array(6).fill(LOSS)))), ['bare-better', 0, 6, 0, 6, 0.03125]);
check('5 losses and 1 win: inconclusive', keep(C(run([...Array(5).fill(LOSS), WIN]))), ['inconclusive', 1, 5, 0, 6, 0.21875]);
// Mean difference threshold, exact. Each diff is 1/10 (boundary, accepted) or 1/11 (below).
const tenth = (i) => pair(i, arm(1, 10), arm(0, 10)); const eleventh = (i) => pair(i, arm(1, 11), arm(0, 11));
check('6 wins with mean diff exactly 0.10 is somi-better; with 1/11 each it is inconclusive', [vs(C([0, 1, 2, 3, 4, 5].map(tenth))), vs(C([0, 1, 2, 3, 4, 5].map(eleventh)))], ['somi-better', 'inconclusive']);
check('a mean diff of exactly 0.10 from mixed denominators is not lost to float rounding', vs(C([pair(0, arm(1, 5), arm(1, 10)), pair(1, arm(3, 10), arm(2, 10)), pair(2, arm(1, 10), arm(0, 10)), pair(3, arm(1, 10), arm(0, 10)), pair(4, arm(1, 10), arm(0, 10)), pair(5, arm(1, 10), arm(0, 10))])), 'somi-better');
check('6 losses with mean diff -0.10 is bare-better; with -1/11 each it is inconclusive', [vs(C([0, 1, 2, 3, 4, 5].map((i) => pair(i, arm(0, 10), arm(1, 10))))), vs(C([0, 1, 2, 3, 4, 5].map((i) => pair(i, arm(0, 11), arm(1, 11)))))], ['bare-better', 'inconclusive']);
// wins > losses is its own rule: 2 big wins and 10 tiny losses is significant (10/12) with a positive mean, yet not somi-better.
const tiny = (i, flip) => (flip ? pair(i, arm(1000, 1000), arm(999, 1000)) : pair(i, arm(0, 1000), arm(1, 1000)));
const bigLossMixed = [0, 1].map((i) => pair(i, arm(4), arm(0))).concat([...Array(10)].map((_, i) => tiny(i + 2)));
const bigWinMixed = [0, 1].map((i) => pair(i, arm(0), arm(4))).concat([...Array(10)].map((_, i) => tiny(i + 2, true)));
check('a significant split with more losses but a positive mean diff is inconclusive, not somi-better; and the mirror is not bare-better', [keep(C(bigLossMixed)), keep(C(bigWinMixed))], [['inconclusive', 2, 10, 0, 12, 0.03857421875], ['inconclusive', 10, 2, 0, 12, 0.03857421875]]);
// Exact ties by cross-multiplication.
check('1/3 against 2/6 is an exact tie; 333/1000 against 1/3 is a loss; 334/1000 a win', [1, 2, 3].map((k) => keep(C([pair(0, ...[[arm(1, 3), arm(2, 6)], [arm(333, 1000), arm(1, 3)], [arm(334, 1000), arm(1, 3)]][k - 1])]))?.slice(1, 4)), [[0, 0, 1], [0, 1, 0], [1, 0, 0]]);
// Early stop: the first 3 usable pairs tie, whatever follows.
check('3, 4 and 5 pairs with the first 3 tying stop with no signal', [3, 4, 5].map((n) => vs(C(run([TIE, TIE, TIE, ...Array(n - 3).fill(WIN)])))), Array(3).fill('stop-no-signal'));
check('the early stop has no upper bound: 3 ties then 3 wins, 3 ties then 6 wins, 3 ties then 3 losses all stop', [vs(C(run([TIE, TIE, TIE, WIN, WIN, WIN]))), vs(C(run([TIE, TIE, TIE, ...Array(6).fill(WIN)]))), vs(C(run([TIE, TIE, TIE, LOSS, LOSS, LOSS])))], Array(3).fill('stop-no-signal'));
check('two ties then a win does not stop, and fewer than 3 usable pairs never stop', [vs(C(run([TIE, TIE, WIN]))), vs(C(run([TIE, TIE]))), vs(C(run([TIE])))], ['inconclusive', 'inconclusive', 'inconclusive']);
check('the first 3 are counted over usable pairs in input order: an invalid pair in front is skipped', vs(C(run([[arm(0, 4, 'invalid'), arm(1)], TIE, TIE, TIE, WIN]))), 'stop-no-signal');
check('the ceiling wins over the early stop: three ties with bare at 1.0 are uninformative, and three ties with bare below 1.0 are not', [vs(C(run([[arm(4), arm(4)], [arm(4), arm(4)], [arm(4), arm(4)]]))), vs(C(run([[arm(4), arm(4)], TIE, TIE, TIE])))], ['uninformative', 'stop-no-signal']);
// Ceiling.
const cap = [arm(4), arm(4)];
check('bare at 1.0 on exactly half the usable pairs is uninformative; on a third of them it is not', [vs(C(run([cap, cap, cap, WIN, WIN, WIN]))), vs(C(run([cap, cap, WIN, WIN, WIN, WIN])))], ['uninformative', 'inconclusive']);
check('the ceiling wins over bare-better: 6 losses against a bare arm at 1.0', [vs(C(run(Array(6).fill([arm(0), arm(4)])))), C(run(Array(6).fill([arm(0), arm(4)]))).ceiling], ['uninformative', 6]);
check('a bare arm that is paused is not at ceiling', C(run([[arm(0), arm(4, 4, 'paused')], WIN])).ceiling, 0);
// Paused and over-budget.
const pz = C(run([[arm(4, 4, 'paused'), arm(2)], [arm(4, 4, 'paused'), arm(2)], [arm(4, 4, 'over-budget'), arm(2)], [arm(1), arm(4, 4, 'paused')], [arm(2), arm(2, 4, 'over-budget')], [arm(1), arm(3, 4, 'over-budget')]]));
check('a paused or over-budget arm scores 0 whatever green it carries (SoMi side: losses, bare side: wins), and the four counts are kept apart', [pz.wins, pz.losses, pz.pausedSomi, pz.overBudgetSomi, pz.pausedBare, pz.overBudgetBare, pz.n], [3, 3, 2, 1, 1, 2, 6]);
check('a paused SoMi arm with green 0 against a bare 0 is a tie, not a loss', keep(C(run([[arm(0, 4, 'paused'), arm(0)], WIN]))).slice(1, 4), [1, 0, 1]);
// Exclusion.
const ex = C(run([[arm(0, 4, 'invalid'), arm(1)], [arm(1), arm(0, 4, 'invalid')], WIN, WIN, WIN, WIN, WIN, WIN]));
check('an invalid arm on either side excludes the pair, which is counted; paused counts of an excluded pair are not', [ex.excluded, ex.n, ex.wins, ex.verdict, C(run([[arm(0, 4, 'invalid'), arm(1, 4, 'paused')], WIN])).pausedBare], [2, 6, 6, 'somi-better', 0]);
const allEx = C(run([[arm(0, 4, 'invalid'), arm(1)], [arm(1), arm(0, 4, 'invalid')]]));
check('all pairs excluded is inconclusive with the exclusion counted and no p', [allEx.verdict, allEx.reason, allEx.excluded, allEx.n, allEx.p, allEx.meanDiff, allEx.medianCostRatio], ['inconclusive', 'no usable pair', 2, 0, null, null, null]);
// Cost ratio: reported, never decisive.
const ratio = (costs) => C(run(costs.map(([a, b]) => [arm(1, 4, 'scored', a), arm(1, 4, 'scored', b)]))).medianCostRatio;
check('the median cost ratio is somi over bare: odd count, even count (mean of the middle two), zero or missing cost skipped, none -> null, sorted numerically (10, 9, 2 -> 9)', [ratio([[2, 1], [3, 1], [9, 1]]), ratio([[2, 1], [4, 1]]), ratio([[2, 1], [5, 0]]), ratio([[0, 1], [4, 2]]), C(run([TIE])).medianCostRatio, ratio([[10, 1], [9, 1], [2, 1]])], [3, 3, 2, 2, null, 9]);
check('cost 0 and the bounds 1e-6 and 1e6 are accepted (the ratio stays finite); 1e-7, a cost above 1e6 and a subnormal are refused', [ratio([[1e6, 1e-6]]), C(run([[arm(1, 4, 'scored', 0), arm(1)]])) !== null, C(run([[arm(1, 4, 'scored', 1e-7), arm(1)]])), C(run([[arm(1, 4, 'scored', 1000001), arm(1)]])), C(run([[arm(1, 4, 'scored', 5e-324), arm(1)]]))], [1e12, true, null, null, null]);
check('the cost never changes the verdict', vs(C(run(Array(6).fill(WIN).map(([s, b]) => [{ ...s, cost: 1000 }, { ...b, cost: 1 }])))), 'somi-better');
check('meanDiff is reported with ties included', C(run([WIN, TIE])).meanDiff, 0.25);

const first = (r) => [r.rule_id, r.reason.slice(0, 20)];
check('every verdict carries the rule id and a reason that names its rule', [C(run(Array(6).fill(WIN))), C(run(Array(6).fill(LOSS))), C(run([cap, cap, cap, WIN, WIN, WIN])), C(run([TIE, TIE, TIE, WIN])), C(run([WIN, LOSS])), C([{ task: 'a', somi: arm(1, 4, 'invalid'), bare: arm(1) }])].map(first), [['a-b-compare-v1', '6 wins, 0 losses, p '], ['a-b-compare-v1', '6 losses, 0 wins, p '], ['a-b-compare-v1', 'bare arm at ceiling '], ['a-b-compare-v1', 'the first 3 usable p'], ['a-b-compare-v1', 'no rule fired: 1 win'], ['a-b-compare-v1', 'no usable pair']]);
// NF2: the verdict probabilities, summed over every win/loss/tie vector with a test-local pmf (never imported).
const rows = [[1]]; for (let n = 1; n <= 6; n++) rows.push([...Array(n + 1)].map((_, k) => (rows[n - 1][k - 1] ?? 0) + (rows[n - 1][k] ?? 0)));
const tailRef = (k, n) => { let t = 0; for (let i = k; i <= n; i++) t += rows[n][i] / 2 ** n; return t; };
const kind = [WIN, LOSS, TIE];
const sums = (n, probs) => { const out = {}; for (let code = 0; code < 3 ** n; code++) { const v = []; let c = code; for (let i = 0; i < n; i++) { v.push(c % 3); c = Math.floor(c / 3); } const pr = v.reduce((a, d) => a * probs[d], 1); const r = C(run(v.map((d) => kind[d]))); out[r.verdict] = (out[r.verdict] ?? 0) + pr; } return out; };
const near = (got, want) => Math.abs(got - want) <= 0.0005;
const six = sums(6, [0.5, 0.5, 0]);
check('NF2 n=6, no ties, each pair 50/50: P(somi-better) = P(bare-better) = 1/64 and everything else is inconclusive', [near(six['somi-better'], 1 / 64), near(six['bare-better'], 1 / 64), near(six.inconclusive, 62 / 64), six['stop-no-signal'] ?? 0], [true, true, true, 0]);
const five = sums(5, [0.25, 0.25, 0.5]);
check('NF2 n=5, ties half the time: P(stop-no-signal) = P(first 3 tie) = 1/8, no verdict is ever somi-better (5/5 has p 0.0625)', [near(five['stop-no-signal'], 0.125), five['somi-better'] ?? 0, five['bare-better'] ?? 0, near(five.inconclusive, 0.875)], [true, 0, 0, true]);
let worst = 0; for (let w = 0; w <= 6; w++) for (let l = 0; w + l <= 6; l++) { const r = C(run([...Array(w).fill(WIN), ...Array(l).fill(LOSS), ...Array(6 - w - l).fill(TIE)])); const nn = w + l; worst = Math.max(worst, Math.abs(r.p - (nn === 0 ? 1 : Math.min(1, 2 * tailRef(Math.max(w, l), nn))))); }
check('NF2 p over every (wins, losses) split of 6 pairs equals twice the reference tail to 1e-12', worst < 1e-12, true);

// Hostile input: every one is null, never a throw.
const good = () => run([[arm(2), arm(0)]]);
const nul = (name, v, o) => check(name, (() => { try { return C(v, o); } catch { return 'THREW'; } })(), null);
nul('non-arrays, an empty list and 65 pairs', [], undefined); nul('a string', 'x'); nul('undefined', undefined); nul('an object', {});
nul('65 pairs', [...Array(65)].map((_, i) => pair(i, ...WIN)));
check('64 pairs are accepted', C([...Array(64)].map((_, i) => pair(i, ...WIN))) !== null, true);
const holes = good(); holes.length = 2; nul('a sparse array', holes);
nul('an array with an extra key', Object.assign(good(), { x: 1 }));
nul('duplicate tasks', [pair(0, ...WIN), pair(0, ...WIN)]);
for (const t of ['', 'a b', 'a/b', 'x'.repeat(65), 'é', 5, null]) nul(`task ${JSON.stringify(t)}`, [{ ...pair(0, ...WIN), task: t }]);
for (const [what, patch] of [['a non-integer green', { green: 1.5 }], ['a negative green', { green: -1 }], ['green above total', { green: 5 }], ['a zero total', { total: 0 }], ['a total above the cap', { total: 1000001, green: 0 }], ['a string green', { green: '1' }], ['NaN green', { green: NaN }], ['an unknown outcome', { outcome: 'failed' }], ['a missing outcome', { outcome: undefined }], ['an infinite cost', { cost: Infinity }], ['a negative cost', { cost: -1 }], ['a NaN cost', { cost: NaN }], ['a string cost', { cost: '1' }], ['an undefined cost key', { cost: undefined }], ['an unknown arm key', { extra: 1 }]]) {
  for (const side of ['somi', 'bare']) nul(`${what} on the ${side} arm`, [{ ...good()[0], [side]: { ...arm(1), ...patch } }]);
}
check('an inherited cost is not read (Object.prototype.cost set only inside this check)', (() => { Object.prototype.cost = 7; try { const r = C(good()); return [r !== null, r?.medianCostRatio]; } finally { delete Object.prototype.cost; } })(), [true, null]);
nul('a missing arm key', [{ task: 't', somi: { green: 1, total: 4 }, bare: arm(1) }]);
nul('an unknown pair key', [{ ...good()[0], extra: 1 }]); nul('a missing pair key', [{ task: 't', somi: arm(1) }]);
nul('a pair that is an array, null or a class instance', [[]]); nul('a null pair', [null]); nul('a class instance pair', [Object.assign(new (class X {})(), good()[0])]);
let calls = 0; const getterPair = good()[0]; Object.defineProperty(getterPair.somi, 'green', { get() { calls++; return 1; }, enumerable: true });
nul('a getter field', [getterPair]); check('a getter is never called', calls, 0);
const hid = good()[0]; Object.defineProperty(hid.somi, 'total', { value: 4, enumerable: false }); nul('a non-enumerable field', [hid]);
nul('a throwing Proxy', new Proxy(good(), { get() { throw new Error('x'); } }));
nul('a Proxy that lies about its keys', [new Proxy(good()[0], { ownKeys() { throw new Error('x'); } })]);
nul('opts that are not empty', good(), { x: 1 }); nul('opts that are not an object', good(), 5); nul('null opts', good(), null);
check('an empty opts object and a null-prototype pair are accepted', [C(good(), {}) !== null, C([Object.assign(Object.create(null), good()[0])]) !== null], [true, true]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOS
)
suite() { LIB="$1" node --input-type=module -e "$CODE" 2>&1; }
out=$(suite "$ROOT/tests/evals/lib") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# Mutation: each rule is broken on a scratch copy of the library; the suite must then fail.
nm=0
mutant() { # from, to, label
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/compare.mjs "$d/"
  if ! M_FILE="$d/compare.mjs" M_FROM="$1" M_TO="$2" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation target not found: %s\n' "$3"; return; fi
  if suite "$d" | grep -q '^FAIL'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$3"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$3"; fi
}
mutant "ALPHA: 0.05" "ALPHA: 0.1" "alpha"
mutant "MIN_MEAN_DIFF: 0.10" "MIN_MEAN_DIFF: 0.05" "minimum mean difference"
mutant "significant && wins > losses && big(1)" "significant && big(1)" "somi-better needs wins > losses"
mutant "significant && losses > wins && big(-1)" "significant && big(-1)" "bare-better needs losses > wins"
mutant "losses > wins && big(-1)" "losses > wins && big(1)" "bare-better sign of the mean difference"
mutant "n >= RULE.EARLY_STOP_PAIRS &&" "" "early stop needs 3 usable pairs"
mutant "if (BigInt(ceiling) * SHARE_D >= SHARE_N * BigInt(n)) return done('uninformative'" "if (BigInt(ceiling) * SHARE_D >= SHARE_N * BigInt(n) && !(n >= RULE.EARLY_STOP_PAIRS && dirs.slice(0, RULE.EARLY_STOP_PAIRS).every((d) => d === 0))) return done('uninformative'" "ceiling is checked before the early stop"
mutant "if (n >= RULE.EARLY_STOP_PAIRS && dirs" "if (n >= RULE.EARLY_STOP_PAIRS && n < 6 && dirs" "early stop has no upper bound"
mutant "EARLY_STOP_PAIRS: 3" "EARLY_STOP_PAIRS: 2" "early stop count"
mutant ".every((d) => d === 0)) return done" ".some((d) => d === 0)) return done" "early stop needs all ties"
mutant "BigInt(ceiling) * SHARE_D >= SHARE_N" "BigInt(ceiling) * SHARE_D > SHARE_N" "ceiling at exactly half"
mutant "CEILING_SHARE: 0.5" "CEILING_SHARE: 0.6" "ceiling share"
mutant "green: outcome === 'scored' ? green : 0" "green" "paused and over-budget score 0"
mutant "p.bare.outcome !== 'invalid' && " "" "invalid bare arm excludes the pair"
mutant "&& p.somi.outcome !== 'invalid'" "" "invalid SoMi arm excludes the pair"
mutant "const excluded = all.length - n;" "const excluded = 0;" "excluded is counted"
mutant "l > r ? 1 : l < r ? -1 : 0" "l >= r ? 1 : l < r ? -1 : 0" "an exact tie is a tie"
mutant "if (i >= k) sum += c;" "if (i > k) sum += c;" "sign-test tail includes the observed count"
mutant "Number(2n * tail)" "Number(tail)" "two-sided doubling"
mutant "Math.min(1, " "(" "p capped at 1"
mutant "(s[m - 1] + s[m]) / 2" "s[m]" "median of an even count"
mutant "q.bare.cost > 0 && q.somi.cost > 0" "q.bare.cost >= 0 && q.somi.cost > 0" "zero bare cost skipped"
mutant "Reflect.ownKeys(pairs).length !== n + 1" "false" "dense array"
mutant "n < 1 || n > MAX_PAIRS ||" "n < 1 ||" "pair cap"
mutant "|| seen.has(p.task)" "" "duplicate tasks"
mutant "|| green > total ||" "||" "green above total"
mutant "Object.hasOwn(a, 'cost') ? a.cost : undefined" "'cost' in a ? a.cost : undefined" "an inherited cost is not read"
mutant "cost <= MAX_COST" "true" "cost upper cap"
mutant "cost >= MIN_COST" "cost >= 0" "cost lower bound"
mutant "[...xs].sort((a, b) => a - b)" "[...xs].sort()" "numeric median sort"
mutant "const RULE_ID = 'a-b-compare-v1'" "const RULE_ID = 'x'" "rule id"
mutant "pausedSomi: count('somi', 'paused'), overBudgetSomi: count('somi', 'over-budget')" "pausedSomi: count('somi', 'over-budget'), overBudgetSomi: count('somi', 'paused')" "SoMi paused and over-budget counts are kept apart"
mutant "pausedBare: count('bare', 'paused'), overBudgetBare: count('bare', 'over-budget')" "pausedBare: count('bare', 'over-budget'), overBudgetBare: count('bare', 'paused')" "bare paused and over-budget counts are kept apart"
mutant "!Number.isInteger(green) ||" "" "integer green"
mutant "total > MAX_TOTAL" "false" "total cap"
mutant "!OUTCOMES.includes(outcome)" "false" "outcome allowlist"
mutant "keys.some((k) => !req.includes(k) && !opt.includes(k)) ||" "" "unknown keys"
mutant "|| !d.enumerable" "" "enumerable-only fields"
mutant "if (opts !== undefined) fields(opts, []);" "" "opts is reserved"
mutant "!TASK.test(p.task) ||" "" "task id characters"

ran=$((pass + fail))
[ "$ran" -ge 134 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 134 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
