// Paired SoMi-versus-bare comparison: the pre-registered decision rule as a pure function over explicit inputs.
// No I/O. compareArms returns a result object, or `null` for an input shape it was not written for (never a
// throw), so a malformed record can never read as a verdict. The inputs are hostile data: each field is read once
// from own enumerable data properties (a getter, a Proxy that answers twice, a sparse array, an inherited or
// unknown key is a refusal) into a plain copy.
//
// compareArms(pairs, opts) -> {verdict, reason, rule_id, wins, losses, ties, n, excluded, p, meanDiff, ceiling,
//   medianCostRatio, pausedSomi, overBudgetSomi, pausedBare, overBudgetBare} or null.
//   pairs  array of 1..64 objects {task, bare, somi}; task is a unique string of 1..64 characters [A-Za-z0-9._-];
//          each arm is {green, total, outcome} plus an optional cost: green and total are integers with
//          0 <= green <= total, 1 <= total <= 1000000; cost, when the own key is present, is 0 or a number from
//          1e-6 to 1e6 (so a cost ratio is always finite);
//          outcome is one of scored, paused, over-budget, invalid. Any other key, a missing key or a wrong type
//          is null. opts is reserved: only undefined or an empty plain object is accepted, so the registered
//          constants cannot be overridden by a caller.
//   An arm that is paused or over-budget scores 0 green (its total stays), whatever green it carries, and is
//   counted (the same on the bare side). A pair with an invalid arm on either side is unusable: it is excluded and
//   counted in `excluded`, never dropped silently; its paused and over-budget states are not counted. Counts and
//   all statistics below are over the usable pairs, in input order. No usable pair is `inconclusive`.
//   The array order is the run order (the early stop reads it). Extra bare noise draws and time ratios are outside
//   this function: it sees one scored arm per side per task.
//   Score is green/total; a pair is a win when the SoMi score is greater, a loss when smaller, a tie when equal,
//   compared by cross-multiplication in BigInt (1/3 and 2/6 tie exactly). meanDiff is the mean of
//   (SoMi score - bare score) over all usable pairs, ties included, truncated to 12 decimals for display; every
//   threshold is decided on exact rationals, never on that float. p is the two-sided exact sign test over the
//   non-tie pairs, min(1, 2 * P(X >= max(wins, losses))) for X ~ Binomial(wins + losses, 1/2), with no non-tie
//   pair p = 1; it is counted in BigInt, and the alpha comparison is exact (the float p is for display).
//   ceiling is the number of usable pairs whose bare score is 1. medianCostRatio is the median of SoMi cost over
//   bare cost for usable pairs where both costs are present and above 0, else null; it is reported, never decisive.
//
// Verdict precedence (first match wins):
//   1. uninformative    the bare arm is at ceiling on at least CEILING_SHARE of the usable pairs.
//   2. stop-no-signal   at least EARLY_STOP_PAIRS usable pairs and the first EARLY_STOP_PAIRS (input order) all tie.
//                       It has no upper bound: later pairs do not undo it.
//   3. somi-better      p <= ALPHA and wins > losses and meanDiff >= MIN_MEAN_DIFF.
//      bare-better      p <= ALPHA and losses > wins and -meanDiff >= MIN_MEAN_DIFF.
//   4. inconclusive     everything else.
// The decimal constants are turned into exact ratios from their printed form, so 0.05 is 5/100, not a float.

export const RULE = Object.freeze({ ALPHA: 0.05, MIN_MEAN_DIFF: 0.10, EARLY_STOP_PAIRS: 3, CEILING_SHARE: 0.5 });
const RULE_ID = 'a-b-compare-v1';

const MAX_PAIRS = 64;
const MAX_TOTAL = 1000000;
const MIN_COST = 1e-6;
const MAX_COST = 1e6;
const OUTCOMES = ['scored', 'paused', 'over-budget', 'invalid'];
const TASK = /^[A-Za-z0-9._-]{1,64}$/;
const ratio = (x) => { const [i, f = ''] = String(x).split('.'); return [BigInt(i + f), 10n ** BigInt(f.length)]; };
const [ALPHA_N, ALPHA_D] = ratio(RULE.ALPHA);
const [DIFF_N, DIFF_D] = ratio(RULE.MIN_MEAN_DIFF);
const [SHARE_N, SHARE_D] = ratio(RULE.CEILING_SHARE);

class Bad extends Error {}
const bad = () => { throw new Bad(); };
// Own enumerable data property (a getter or accessor is refused, never called).
function own(o, key) {
  const d = Reflect.getOwnPropertyDescriptor(o, key);
  if (!d || !('value' in d) || !d.enumerable) bad();
  return d.value;
}
// A plain object with exactly the keys in `req`, plus those of `opt` that are present; the values read once.
function fields(o, req, opt = []) {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) bad();
  const proto = Reflect.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) bad();
  const keys = Reflect.ownKeys(o);
  if (keys.some((k) => !req.includes(k) && !opt.includes(k)) || !req.every((k) => keys.includes(k))) bad();
  return Object.fromEntries(keys.map((k) => [k, own(o, k)]));
}
function readArm(arm) {
  const a = fields(arm, ['green', 'total', 'outcome'], ['cost']);
  const { green, total, outcome } = a;
  if (!Number.isInteger(green) || !Number.isInteger(total) || green < 0 || total < 1 || green > total || total > MAX_TOTAL) bad();
  if (!OUTCOMES.includes(outcome)) bad();
  const cost = Object.hasOwn(a, 'cost') ? a.cost : undefined;
  if (Object.hasOwn(a, 'cost') && !(cost === 0 || (typeof cost === 'number' && cost >= MIN_COST && cost <= MAX_COST))) bad();
  return { green: outcome === 'scored' ? green : 0, total, outcome, cost };
}
function readPairs(pairs) {
  if (!Array.isArray(pairs)) bad();
  const n = pairs.length;
  if (n < 1 || n > MAX_PAIRS || Reflect.ownKeys(pairs).length !== n + 1) bad();
  const seen = new Set();
  return Array.from({ length: n }, (_, i) => {
    const p = fields(own(pairs, String(i)), ['task', 'bare', 'somi']);
    if (typeof p.task !== 'string' || !TASK.test(p.task) || seen.has(p.task)) bad();
    seen.add(p.task);
    return { bare: readArm(p.bare), somi: readArm(p.somi) };
  });
}

const cmp = (a, b) => { const l = BigInt(a.green) * BigInt(b.total); const r = BigInt(b.green) * BigInt(a.total); return l > r ? 1 : l < r ? -1 : 0; };
// Sum over the exact tail: the number of Binomial(n, 1/2) outcomes (out of 2^n) with at least k successes.
function tailCount(k, n) {
  let c = 1n; let sum = 0n;
  for (let i = 0; i <= n; i++) { if (i >= k) sum += c; c = (c * BigInt(n - i)) / BigInt(i + 1); }
  return sum;
}
function median(xs) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/** Pairs (see the header) -> a result object, or `null` for malformed input. */
export function compareArms(pairs, opts) {
  try {
    if (opts !== undefined) fields(opts, []);
    const all = readPairs(pairs);
    const usable = all.filter((p) => p.bare.outcome !== 'invalid' && p.somi.outcome !== 'invalid');
    const n = usable.length;
    const excluded = all.length - n;
    const dirs = usable.map((p) => cmp(p.somi, p.bare));
    const wins = dirs.filter((d) => d > 0).length;
    const losses = dirs.filter((d) => d < 0).length;
    const count = (arm, outcome) => usable.filter((p) => p[arm].outcome === outcome).length;
    const base = { rule_id: RULE_ID, wins, losses, ties: n - wins - losses, n, excluded, pausedSomi: count('somi', 'paused'), overBudgetSomi: count('somi', 'over-budget'), pausedBare: count('bare', 'paused'), overBudgetBare: count('bare', 'over-budget') };
    if (n === 0) return { verdict: 'inconclusive', reason: 'no usable pair', ...base, p: null, meanDiff: null, ceiling: 0, medianCostRatio: null };

    // Exact mean difference as a fraction num/den (per pair), plus the display float.
    let num = 0n; let den = 1n;
    for (const p of usable) { const b = BigInt(p.bare.total); const s = BigInt(p.somi.total); num = num * b * s + (BigInt(p.somi.green) * b - BigInt(p.bare.green) * s) * den; den *= b * s; }
    const meanDiff = Number((num * 10n ** 12n) / (den * BigInt(n))) / 1e12;
    const nonTie = wins + losses;
    const tail = tailCount(Math.max(wins, losses), nonTie);
    const p = nonTie === 0 ? 1 : Math.min(1, Number(2n * tail) / 2 ** nonTie);
    const significant = nonTie > 0 && 2n * tail * ALPHA_D <= ALPHA_N * 2n ** BigInt(nonTie);
    const big = (sign) => BigInt(sign) * num * DIFF_D >= DIFF_N * den * BigInt(n);
    const ceiling = usable.filter((q) => q.bare.outcome === 'scored' && q.bare.green === q.bare.total).length;
    const costs = usable.filter((q) => q.bare.cost > 0 && q.somi.cost > 0).map((q) => q.somi.cost / q.bare.cost);
    const out = { ...base, p, meanDiff, ceiling, medianCostRatio: costs.length ? median(costs) : null };
    const done = (verdict, reason) => ({ verdict, reason, ...out });

    if (BigInt(ceiling) * SHARE_D >= SHARE_N * BigInt(n)) return done('uninformative', `bare arm at ceiling on ${ceiling}/${n} usable pairs`);
    if (n >= RULE.EARLY_STOP_PAIRS && dirs.slice(0, RULE.EARLY_STOP_PAIRS).every((d) => d === 0)) return done('stop-no-signal', `the first ${RULE.EARLY_STOP_PAIRS} usable pairs all tie`);
    if (significant && wins > losses && big(1)) return done('somi-better', `${wins} wins, ${losses} losses, p ${p} <= ${RULE.ALPHA}, mean diff ${meanDiff} >= ${RULE.MIN_MEAN_DIFF}`);
    if (significant && losses > wins && big(-1)) return done('bare-better', `${losses} losses, ${wins} wins, p ${p} <= ${RULE.ALPHA}, mean diff ${meanDiff} <= -${RULE.MIN_MEAN_DIFF}`);
    return done('inconclusive', `no rule fired: ${wins} wins, ${losses} losses, p ${p}, mean diff ${meanDiff}`);
  } catch {
    return null;
  }
}
