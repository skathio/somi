#!/usr/bin/env bash
# Pins the usage and speed benchmark's statistics (tests/evals/lib/bench-stats.mjs) and its pre-registered rule
# (tests/evals/lib/bench-rule.mjs + benchmarks/usage-speed/rule.json): known-answer intervals checked against a
# second, test-local implementation, byte-identical replay, null on every domain error, the rule's shape, hash
# and sealed state. Each rule is then mutated on a scratch copy and the suite must fail.
# Hermetic: pure computation; no model, network, git, wall clock or credential. Skipped in a tarball.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: benchmark statistics and rule =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t bst.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
const S = await import(`${process.env.LIB}/bench-stats.mjs`);
const R = await import(`${process.env.LIB}/bench-rule.mjs`);
const fs = await import('node:fs');
const crypto = await import('node:crypto');
const RULE_FILE = process.env.RULE_FILE;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);

// ---- a second, deliberately plain implementation (own PRNG copy, no shared code) ----
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const med = (xs) => { const s = [...xs].sort((p, q) => p - q); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const gm = (xs) => Math.exp(xs.reduce((t, x) => t + Math.log(x), 0) / xs.length);
function ref(scenarios, seed, R_, lo, hi) {
  const rnd = prng(seed); const out = [];
  for (let r = 0; r < R_; r++) {
    const ratios = [];
    for (const { a, b } of scenarios) {
      const pa = a.map(() => a[Math.floor(rnd() * a.length)]);
      const pb = b.map(() => b[Math.floor(rnd() * b.length)]);
      ratios.push(med(pa) / med(pb));
    }
    out.push(gm(ratios));
  }
  out.sort((p, q) => p - q);
  return { estimate: gm(scenarios.map(({ a, b }) => med(a) / med(b))), lower: out[lo], upper: out[hi] };
}
const SEED = 20261020;
const same = (name, got, want) => check(name, got && { estimate: got.estimate, lower: got.lower, upper: got.upper }, want);

// ---- median, ratio ----
check('median: odd, even (mean of the two middle), unsorted, negative allowed, single', [S.median([3, 1, 2]), S.median([4, 1, 3, 2]), S.median([10, 9, 2]), S.median([-3, -1]), S.median([7])], [2, 2.5, 9, -2, 7]);
check('median sorts numerically, not lexically', S.median([10, 9, 100, 2, 1]), 9);
check('ratioOfMedians is first over second: exact hand value 2.5 / 6', S.ratioOfMedians([1, 2, 3, 4], [2, 4, 6, 8, 10]), 2.5 / 6);
check('ratioOfMedians direction: a larger than b is above 1, smaller is below 1', [S.ratioOfMedians([4], [2]), S.ratioOfMedians([2], [4])], [2, 0.5]);
check('geometricMean of 1, 4 is 2; of 2, 8 is 4 (to 1e-12)', [Math.abs(S.geometricMean([1, 4]) - 2) < 1e-12, Math.abs(S.geometricMean([2, 8]) - 4) < 1e-12], [true, true]);

// ---- known-answer bootstrap against the reference ----
const R_ = 1000; const o = { seed: SEED, resamples: R_ };
const k = 50; // floor(1000 * 0.1 / 2): the 5th and 95th percentile
const better = { a: [0.48, 0.5, 0.52, 0.49, 0.51, 0.5, 0.47, 0.53], b: [1.0, 1.02, 0.98, 1.01, 0.99, 1.0, 1.03, 0.97] };
const worse = { a: better.b, b: better.a };
const nul = { a: [1.0, 1.1, 0.9, 1.05, 0.95, 1.0, 1.02, 0.98], b: [1.0, 0.95, 1.05, 1.1, 0.9, 1.02, 0.98, 1.0] };
const noisy = { a: [0.2, 3.0, 0.5, 2.4, 1.0, 0.3, 4.0, 1.5], b: [1.0, 0.4, 2.5, 0.8, 3.0, 0.6, 1.2, 2.2] };
const bb = (c) => S.percentileBootstrap(c.a, c.b, o);
for (const [name, c] of [['clear better', better], ['clear worse', worse], ['null effect', nul], ['noisy', noisy]]) {
  same(`${name}: interval equals the reference implementation exactly`, bb(c), ref([c], SEED, R_, k, R_ - 1 - k));
}
const iv = Object.fromEntries([['better', better], ['worse', worse], ['null', nul], ['noisy', noisy]].map(([n, c]) => [n, bb(c)]));
check('clear better: the whole interval lies below 0.9', iv.better.upper < 0.9 && iv.better.estimate < 0.9, true);
check('clear worse: the whole interval lies above 1.1', iv.worse.lower > 1.1 && iv.worse.estimate > 1.1, true);
check('null effect: the interval contains 1 and lies within 0.85 to 1.15', iv.null.lower < 1 && iv.null.upper > 1 && iv.null.lower > 0.85 && iv.null.upper < 1.15, true);
check('interval ordering: better < worse, lower <= estimate <= upper everywhere', [iv.better.upper < iv.worse.lower, ...Object.values(iv).map((v) => v.lower <= v.estimate && v.estimate <= v.upper)], [true, true, true, true, true]);
check('noisy is far wider than the clear and null cases', [iv.noisy.upper - iv.noisy.lower > 3 * (iv.better.upper - iv.better.lower), iv.noisy.upper - iv.noisy.lower > 3 * (iv.null.upper - iv.null.lower)], [true, true]);
check('default level is 90%, default resamples 10000: indices 500 and 9499, equal to the reference', (() => { const r = S.percentileBootstrap(better.a, better.b, { seed: SEED }); const e = ref([better], SEED, 10000, 500, 9499); return [r.resamples, r.level, r.lower === e.lower, r.upper === e.upper]; })(), [10000, 0.9, true, true]);
check('a different seed gives a different interval', JSON.stringify(bb(noisy)) !== JSON.stringify(S.percentileBootstrap(noisy.a, noisy.b, { seed: SEED + 1, resamples: R_ })), true);
check('arms of different lengths are accepted and match the reference', (() => { const c = { a: [1, 2, 3], b: [2, 4, 6, 8, 10] }; const r = S.percentileBootstrap(c.a, c.b, o); const e = ref([c], SEED, R_, k, R_ - 1 - k); return [r.lower === e.lower, r.upper === e.upper]; })(), [true, true]);
check('constant arms collapse the interval onto the exact ratio', (() => { const r = S.percentileBootstrap([3, 3, 3], [6, 6], o); return [r.estimate, r.lower, r.upper]; })(), [0.5, 0.5, 0.5]);

// ---- independence of the arms: the reference draws a then b from one stream, never shared indices ----
check('independent resampling: an interval with equal-length arms differs from joint (same-index) resampling', (() => {
  const rnd = prng(SEED); const out = [];
  for (let r = 0; r < R_; r++) { const idx = noisy.a.map(() => Math.floor(rnd() * noisy.a.length)); out.push(med(idx.map((i) => noisy.a[i])) / med(idx.map((i) => noisy.b[i]))); }
  out.sort((p, q) => p - q);
  return out[k] !== bb(noisy).lower || out[R_ - 1 - k] !== bb(noisy).upper;
})(), true);

// ---- stratified and overhead ----
const strata = [better, nul, noisy];
same('scenarioStratified equals the reference (geometric mean of per-scenario resampled ratios)', S.scenarioStratified(strata, o), ref(strata, SEED, R_, k, R_ - 1 - k));
const ov = S.overheadRatio(strata.map((c) => ({ somi: c.a, bare: c.b })), o);
same('overheadRatio equals the reference with somi as the numerator', ov, ref(strata, SEED, R_, k, R_ - 1 - k));
check('stratified estimate is the geometric mean of the per-scenario point ratios', Math.abs(S.scenarioStratified(strata, o).estimate - gm(strata.map((c) => med(c.a) / med(c.b)))) < 1e-12, true);
check('a single scenario stratified equals the plain bootstrap', JSON.stringify(S.scenarioStratified([better], o)), JSON.stringify(bb(better)));
check('stratified pooling: a clear win in every scenario stays clear, a win with a loss does not', (() => { const w = S.scenarioStratified([better, better, better], o); const m = S.scenarioStratified([better, worse], o); return [w.upper < 0.9, m.lower < 1 && m.upper > 1]; })(), [true, true]);
check('overheadRatio direction: somi slower than bare is above 1', S.overheadRatio([{ somi: [2, 2.1, 1.9], bare: [1, 1.1, 0.9] }], o).lower > 1, true);

// ---- determinism ----
check('same input twice: byte-identical JSON (percentile, stratified, overhead)', (() => { const run = () => JSON.stringify([bb(noisy), S.scenarioStratified(strata, o), S.overheadRatio(strata.map((c) => ({ somi: c.a, bare: c.b })), o)]); return run() === run(); })(), true);
check('the input arrays are not mutated', (() => { const a = [3, 1, 2]; const b = [9, 8, 7]; S.percentileBootstrap(a, b, o); S.median(a); return [a, b]; })(), [[3, 1, 2], [9, 8, 7]]);

// ---- every domain error is null, never NaN, never a throw ----
const safe = (f) => { try { return f(); } catch { return 'THREW'; } };
const bad = [[], [NaN], [Infinity], [-Infinity], [0], [-1], [1, 0], 'abc', null, undefined, 5, { length: 1, 0: 1 }, [1, 'x'], Object.assign([1, 2], { length: 3 })];
for (const v of bad) {
  const label = JSON.stringify(v) ?? String(v);
  check(`ratioOfMedians(${label}, ok) and (ok, ${label}) are null`, [safe(() => S.ratioOfMedians(v, [1])), safe(() => S.ratioOfMedians([1], v))], [null, null]);
  check(`percentileBootstrap with ${label} as either arm is null`, [safe(() => S.percentileBootstrap(v, [1], o)), safe(() => S.percentileBootstrap([1], v, o))], [null, null]);
  check(`geometricMean(${label}) is null`, safe(() => S.geometricMean(v)), null);
}
check('median of an empty array, NaN, Infinity is null (not NaN); zero and negative are fine for median', [S.median([]), S.median([NaN]), S.median([1, Infinity]), S.median([0, -2])].map(String), ['null', 'null', 'null', '-1']);
for (const seed of [undefined, NaN, Infinity, -1, 1.5, 2 ** 32, '7', null]) check(`seed ${String(seed)} is null`, safe(() => S.percentileBootstrap([1, 2], [1, 2], { seed, resamples: 1000 })), null);
check('seed 0 and 2^32 - 1 are accepted', [S.percentileBootstrap([1, 2], [1, 2], { seed: 0, resamples: 100 }) !== null, S.percentileBootstrap([1, 2], [1, 2], { seed: 2 ** 32 - 1, resamples: 100 }) !== null], [true, true]);
for (const resamples of [99, 100001, 0, -5, 1000.5, NaN, Infinity, '1000']) check(`resamples ${String(resamples)} is null`, safe(() => S.percentileBootstrap([1, 2], [1, 2], { seed: 1, resamples })), null);
check('resamples at the bounds 100 and 100000 are accepted', [100, 100000].map((resamples) => S.percentileBootstrap([1, 2], [1, 2], { seed: 1, resamples }) !== null), [true, true]);
for (const level of [0, 1, -0.1, 1.1, NaN, Infinity]) check(`level ${String(level)} is null`, safe(() => S.percentileBootstrap([1, 2], [1, 2], { seed: 1, resamples: 1000, level })), null);
check('opts missing, null or an array is null', [safe(() => S.percentileBootstrap([1], [1])), safe(() => S.percentileBootstrap([1], [1], null)), safe(() => S.percentileBootstrap([1], [1], []))], [null, null, null]);
check('stratified and overhead: empty list, a bad scenario, a non-array and a null scenario are null', [S.scenarioStratified([], o), S.scenarioStratified([{ a: [1], b: [0] }], o), S.scenarioStratified('x', o), S.scenarioStratified([null], o), S.overheadRatio([], o), S.overheadRatio([{ somi: [1], bare: [NaN] }], o), S.overheadRatio(null, o), S.overheadRatio([null], o), S.overheadRatio([{ somi: [1] }], o)], Array(9).fill(null));
check('no output field is ever NaN on a valid call', Object.values(bb(noisy)).every((v) => !Number.isNaN(v)), true);

// ---- the rule file ----
const text = fs.readFileSync(RULE_FILE, 'utf8');
const raw = JSON.parse(text);
const loaded = R.loadRule(RULE_FILE);
check('the shipped rule.json loads, is a draft (sealed false) and version 1', [loaded !== null, loaded?.sealed, loaded?.rule.version], [true, false, 1]);
check('the shipped rule holds exactly the user-verified numbers', loaded && [loaded.rule.bootstrap.level, loaded.rule.bootstrap.resamples, loaded.rule.minEffect.L0, loaded.rule.minEffect.L1, loaded.rule.minEffect.L2, loaded.rule.qualityGuard], [0.9, 10000, 0.01, { effect: 0.1, minRepeats: 30 }, { time: 0.3, cost: 0.2, tokens: 0.2, turns: 0.2 }, { medianDrop: 0.2, invalidShareIncrease: 0.25 }]);
check('the shipped rule\'s seed and resamples are accepted by the statistics', S.percentileBootstrap([1, 2, 3], [1, 2, 3], { seed: loaded.rule.bootstrap.seed, resamples: loaded.rule.bootstrap.resamples, level: loaded.rule.bootstrap.level }) !== null, true);
check('the metric table has the four layers of the registered table with their bases', loaded.rule.metrics.map((m) => [m.layer, m.primaryBasis, m.secondaryBasis]), [['L0', 'absolute', null], ['L1', 'absolute', null], ['L2 time and cost', 'overhead', 'absolute'], ['L2 tokens and turns', 'absolute', 'overhead']]);
const mk = (patch) => { const c = JSON.parse(text); patch(c); return c; };
check('the loaded rule is deep-frozen', [Object.isFrozen(loaded.rule), Object.isFrozen(loaded.rule.minEffect.L1), Object.isFrozen(loaded.rule.metrics[0].metrics)], [true, true, true]);

// canonical hash: independent computation over a hand-sorted serialisation
const small = { version: 1, sealed: false, b: 2, a: { z: [1, { y: 2, x: 1 }], c: 'q' } };
check('hash: sha256 of the canonical form (sorted keys at every depth, no whitespace, sealed excluded)', R.ruleHash(small), crypto.createHash('sha256').update('{"a":{"c":"q","z":[1,{"x":1,"y":2}]},"b":2,"version":1}').digest('hex'));
check('hash is stable across key order at every depth', R.ruleHash(JSON.parse('{"version":1,"b":2,"a":{"c":"q","z":[1,{"x":1,"y":2}]}}')), R.ruleHash(small));
const rev = (v) => (Array.isArray(v) ? v.map(rev) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((q) => [q, rev(v[q])])) : v);
check('hash is stable across key order of the real rule (every depth reversed)', R.parseRule(rev(raw))?.hash, loaded.hash);
check('hash does not depend on sealed (sealing keeps the hash)', R.parseRule(mk((c) => { c.sealed = true; })).hash, loaded.hash);
check('reordering the metrics rows changes the hash (arrays keep their order)', R.parseRule(mk((c) => { c.metrics.reverse(); })).hash !== loaded.hash, true);
check('hash changes when version changes', R.ruleHash(mk((c) => { c.version = 2; })) !== loaded.hash, true);
const changes = [['level', (c) => { c.bootstrap.level = 0.95; }], ['resamples', (c) => { c.bootstrap.resamples = 5000; }], ['seed', (c) => { c.bootstrap.seed = 1; }], ['L0', (c) => { c.minEffect.L0 = 0.02; }], ['L1 effect', (c) => { c.minEffect.L1.effect = 0.11; }], ['L1 repeats', (c) => { c.minEffect.L1.minRepeats = 31; }], ['L2 time', (c) => { c.minEffect.L2.time = 0.31; }], ['L2 cost', (c) => { c.minEffect.L2.cost = 0.21; }], ['L2 tokens', (c) => { c.minEffect.L2.tokens = 0.21; }], ['L2 turns', (c) => { c.minEffect.L2.turns = 0.21; }], ['median drop', (c) => { c.qualityGuard.medianDrop = 0.21; }], ['invalid share', (c) => { c.qualityGuard.invalidShareIncrease = 0.26; }], ['metric text', (c) => { c.metrics[0].primary += '!'; }], ['metric basis', (c) => { c.metrics[0].primaryBasis = 'overhead'; }], ['metric list', (c) => { c.metrics[2].metrics.push('x'); }]];
for (const [name, patch] of changes) { const p = R.parseRule(mk(patch)); check(`hash changes when ${name} changes`, p !== null && p.hash !== loaded.hash, true); }
check('hash is 64 lowercase hex characters', /^[0-9a-f]{64}$/.test(loaded.hash), true);
check('sealed:true is reported as sealed, sealed:false as not', [R.parseRule(mk((c) => { c.sealed = true; })).sealed, loaded.sealed], [true, false]);

// refusals
const refuse = (name, patch) => check(`rule refused: ${name}`, safe(() => R.parseRule(mk(patch))), null);
refuse('unknown top-level key', (c) => { c.extra = 1; });
refuse('unknown nested key', (c) => { c.bootstrap.extra = 1; });
refuse('unknown key in L2', (c) => { c.minEffect.L2.energy = 0.2; });
refuse('unknown key in a metric row', (c) => { c.metrics[0].extra = 1; });
refuse('missing key', (c) => { delete c.qualityGuard; });
refuse('missing nested key', (c) => { delete c.minEffect.L1.minRepeats; });
refuse('version 2', (c) => { c.version = 2; });
refuse('sealed not a boolean', (c) => { c.sealed = 'no'; });
refuse('resamples below 100', (c) => { c.bootstrap.resamples = 99; });
refuse('resamples above 100000', (c) => { c.bootstrap.resamples = 100001; });
refuse('level 1', (c) => { c.bootstrap.level = 1; });
refuse('seed negative', (c) => { c.bootstrap.seed = -1; });
refuse('an effect of 0', (c) => { c.minEffect.L0 = 0; });
refuse('an effect above 1', (c) => { c.minEffect.L2.time = 1.5; });
refuse('an effect as a string', (c) => { c.minEffect.L1.effect = '0.1'; });
refuse('minRepeats 0', (c) => { c.minEffect.L1.minRepeats = 0; });
refuse('minRepeats fractional', (c) => { c.minEffect.L1.minRepeats = 30.5; });
refuse('guard margin 0', (c) => { c.qualityGuard.medianDrop = 0; });
refuse('unknown basis', (c) => { c.metrics[0].primaryBasis = 'relative'; });
refuse('empty metrics', (c) => { c.metrics = []; });
refuse('metric names not strings', (c) => { c.metrics[0].metrics = [1]; });
check('non-objects are refused: null, array, string, number, undefined', [null, [], 'x', 5, undefined].map((v) => safe(() => R.parseRule(v))), Array(5).fill(null));
check('ruleProblems names the unknown key', R.ruleProblems(mk((c) => { c.extra = 1; })).some((p) => p.includes('extra')), true);
const badFile = `${process.env.TMPD}/bad.json`; fs.writeFileSync(badFile, '{not json');
check('loadRule: a missing file and invalid JSON are null', [R.loadRule(`${process.env.TMPD}/missing.json`), R.loadRule(badFile)], [null, null]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOS
)
suite() { LIB="$1" TMPD="$TMP" RULE_FILE="$ROOT/benchmarks/usage-speed/rule.json" node --input-type=module -e "$CODE" 2>&1; }
out=$(suite "$ROOT/tests/evals/lib") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# Mutation: each rule is broken on a scratch copy of the libraries; the suite must then fail.
nm=0
mutant() { # file, from, to, label
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/bench-stats.mjs tests/evals/lib/bench-rule.mjs tests/evals/lib/mann-whitney.mjs "$d/"
  if ! M_FILE="$d/$1" M_FROM="$2" M_TO="$3" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation did not apply: %s\n' "$4"; return; fi
  if suite "$d" | grep -q '^FAIL'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$4"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$4"; fi
}
S=bench-stats.mjs; Rl=bench-rule.mjs
mutant $S "ratioOfMedians(a, b) {
  if (!validArm(a, true) || !validArm(b, true)) return null;
  return median(a) / median(b);" "ratioOfMedians(a, b) {
  if (!validArm(a, true) || !validArm(b, true)) return null;
  return median(b) / median(a);" "ratioOfMedians direction flipped"
mutant $S "ratios[s] = num / den;" "ratios[s] = den / num;" "bootstrap ratio direction flipped"
mutant $S "const num = resampleMedian(scenarios[s].a, rng);
      const den = resampleMedian(scenarios[s].b, rng);" "const den = resampleMedian(scenarios[s].b, rng);
      const num = resampleMedian(scenarios[s].a, rng);" "arm draw order"
mutant $S "stats.length - 1 - k" "stats.length - k" "upper percentile index"
mutant $S "stats[k]" "stats[k + 1]" "lower percentile index"
mutant $S "(stats.length * (1 - level)) / 2 + 1e-9" "(stats.length * (1 - level)) / 2" "float epsilon on the percentile index"
mutant $S "const num = resampleMedian(scenarios[s].a, rng);
      const den = resampleMedian(scenarios[s].b, rng);" "const num = resampleMedian(scenarios[s].a, mulberry32(o.seed + r));
      const den = resampleMedian(scenarios[s].b, mulberry32(o.seed + r));" "resampling stream shared across resamples"
mutant $S "return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;" "return s.length % 2 ? s[m] : s[m];" "median of an even count"
mutant $S "[...xs].sort((p, q) => p - q)" "[...xs].sort()" "numeric median sort"
mutant $S "sum += Math.log(xs[i]);" "sum += xs[i];" "geometric mean"
mutant $S "x > 0;" "x >= 0;" "non-positive values refused"
mutant $S "s >= 0 && s < 2 ** 32" "s >= -1 && s < 2 ** 32" "seed range"
mutant $S "resamples < MIN_RESAMPLES" "resamples < 1" "resamples floor"
mutant $S "resamples > MAX_RESAMPLES" "resamples > 1e9" "resamples ceiling"
mutant $S "if (!Array.isArray(xs) || xs.length < 1 || xs.length > MAX_ARM) return false;" "if (!Array.isArray(xs) || xs.length > MAX_ARM) return false;" "empty arm refused"
mutant $S "typeof x !== 'number' || !Number.isFinite(x)" "typeof x !== 'number'" "non-finite values refused"
mutant $Rl "ruleHash(rule) {
  const { sealed: _sealed, ...content } = rule;" "ruleHash(rule) {
  const content = rule;" "hash excludes sealed"
mutant $Rl 'Object.keys(v).sort().map' 'Object.keys(v).map' "hash canonicalisation: keys sorted"
mutant $Rl "createHash('sha256')" "createHash('sha1')" "hash algorithm"
mutant $Rl "if (!keys.includes(k)) out.push" "if (false) out.push" "unknown keys refused"
mutant $Rl "if (rule.version !== 1)" "if (false)" "version pinned"
mutant $Rl "x > 0 && x <= 1;" "x > 0;" "fraction upper bound"
mutant $Rl "freeze(rule)" "rule" "rule deep-frozen"
mutant $Rl "sealed: rule.sealed" "sealed: false" "sealed state reported"

ran=$((pass + fail))
[ "$ran" -ge 150 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 150 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
