#!/usr/bin/env node
// Tie-conditional Mann-Whitney U via Monte Carlo resampling (phase 3, D3/D5). The method is
// stated once, identically, in decisions.md's D3 implementation note, D5, and
// phases/03-convergence-gating.md's iteration 3.2 -- this file is the one place it is executed.
//
// WHY MONTE CARLO, NOT THE CLASSIC EXACT DP RECURSION: the standard closed-form/recursive exact
// null distribution for Mann-Whitney U (Mann & Whitney 1947) assumes every value in the pooled
// sample is DISTINCT. Convergence-cost data is small positive integers with heavy ties (D5: 18 of
// 21 historical draws fall in {1,2,3}) -- ties are the dataset here, not an edge case. Applying the
// untied recursion anyway measured 1.5-3.6x CONSERVATIVE on realistic tied arms during this work
// item's planning pass -- the direction that HIDES a real regression, disqualifying for a
// regression gate. The tie-conditional permutation distribution -- resampling the pooled MULTISET
// (duplicates and all) without replacement -- is the statistically correct treatment; it has no
// closed form at arbitrary tie patterns, so it is estimated by Monte Carlo.

/**
 * The resample count and its Monte Carlo standard error are part of this function's documented
 * contract (D3/D5), not an implementation detail left implicit.
 *
 * 200,000: in the "low hundred-thousands" D3/D5 call for -- comfortably under a second in stdlib
 * Node at the arm sizes this gate actually uses (O(resamples * n1 * n2); measured ~300ms at
 * n1=n2=15, D2's chosen N, three runs on this repo's own dev hardware) -- and it bounds the
 * WORST-CASE (p=0.5, where a Bernoulli proportion's variance is maximised) Monte Carlo standard
 * error of the returned `p` at `0.5 / sqrt(200000) ~= 0.00112`, small relative to the alpha=0.05
 * (D5) this gate operates near. A caller that wants the tighter, actual-p bound reads `mcError`
 * (below) instead of assuming the worst case.
 */
export const DEFAULT_RESAMPLES = 200_000;

// Nit: resamples had a floor but no ceiling -- {resamples: 1e12} hung with no signal.
export const MAX_RESAMPLES = 10_000_000;

// F-203: deterministic PRNG (mulberry32) -- pass { rng: mulberry32(seed) } for a reproducible run;
// default stays Math.random. Needed once 3.3 starts persisting p-values (a recorded p must replay
// from its stored arms, and a failing oracle must be re-runnable).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertNumericArm(arm, label) {
  if (!Array.isArray(arm) || arm.length < 1) {
    throw new RangeError(`mannWhitneyU: ${label} must be a non-empty array, got ${JSON.stringify(arm)}`);
  }
  for (const v of arm) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new RangeError(`mannWhitneyU: ${label} must contain only finite numbers, got ${JSON.stringify(arm)}`);
    }
  }
}

/**
 * The Mann-Whitney U statistic for `sampleB` relative to `sampleA`: the count of cross-pairs
 * (a in sampleA, b in sampleB) with b > a, plus 0.5 per exact tie -- the standard mid-rank tie
 * credit, correct for computing U itself regardless of how the null distribution is obtained.
 * (Only the null distribution -- not the U statistic -- is where the untied-vs-tie-conditional
 * distinction above lives.) O(n1*n2); n is small enough here (<=~20/arm) that a sort-based
 * O(n log n) rank computation would save nothing worth the added surface for tie-averaging bugs.
 */
function rankSumU(sampleA, sampleB) {
  let u = 0;
  for (const b of sampleB) {
    for (const a of sampleA) {
      if (b > a) u += 1;
      else if (b === a) u += 0.5;
    }
  }
  return u;
}

/**
 * Tie-conditional Mann-Whitney U, one-sided, computed by Monte Carlo resampling (D3, D5).
 *
 * **The method** (stated identically in `decisions.md` D3's implementation note and D5, and in
 * `phases/03-convergence-gating.md` iteration 3.2): pool `armA` and `armB` into one multiset of
 * `n1 + n2` values; repeatedly resample an `n1`-sized split WITHOUT REPLACEMENT, uniform over the
 * pooled multiset -- drawing a uniform random `n1`-subset of the pool's INDICES (not values) is
 * what makes this condition on the observed ties: every one of the `C(n1+n2, n1)` index-splits is
 * equally likely, including splits that land on duplicate-valued elements, which is exactly the
 * combinatorial object the untied DP recursion cannot represent. Recompute U for each resample;
 * the returned `p` is the resampled fraction whose U is at least as extreme (>=) as the observed
 * U, add-one corrected (F-200: `(1 + extreme) / (1 + resamples)`, bounding `p` away from exact 0 --
 * see the `p` bullet below) -- one-sided (D5), toward "armB stochastically greater than armA", the
 * direction a regression gate cares about (D5: "the actual concern is specifically regression...
 * not different in either direction"). A caller comparing baseline vs. candidate convergence cost
 * passes baseline as `armA` and candidate as `armB`; a candidate converging in MORE passes trends
 * toward this function's tested direction.
 *
 * @param {number[]} armA  e.g. baseline convergence-cost draws. Must be non-empty finite numbers.
 * @param {number[]} armB  e.g. candidate convergence-cost draws. Must be non-empty finite numbers.
 * @param {{resamples?: number, rng?: () => number}} [options]
 * @param {number} [options.resamples=DEFAULT_RESAMPLES]  resample count (must be a positive
 *   integer). Trades runtime directly for the Monte Carlo standard error reported in `mcError`.
 * @param {() => number} [options.rng=Math.random]  uniform [0,1) source; pass `mulberry32(seed)`
 *   (F-203, exported above) for a reproducible run.
 * @returns {{U: number, p: number, direction: 'A>B'|'B>A'|'tie', mcError: number}}
 *   `U`: the OBSERVED Mann-Whitney U for armB relative to armA (`rankSumU`, above) -- exact, not
 *     itself subject to Monte Carlo error; only `p` is resampled.
 *   `p`: the one-sided empirical p-value (see "The method" above); add-one corrected (F-200), so
 *     never exactly 0.
 *   `direction`: which arm's values observably rank higher -- `'B>A'` if the observed U exceeds
 *     `n1*n2/2` (the null distribution's midpoint), `'A>B'` if below, `'tie'` at exact equality.
 *     Purely descriptive of the OBSERVED sample; independent of which direction `p` tests.
 *   `mcError`: the Monte Carlo standard error of `p` itself, `sqrt(p*(1-p)/resamples)` -- the
 *     standard error of a resampled proportion (a Bernoulli count over `resamples` trials).
 */
export function mannWhitneyU(armA, armB, { resamples = DEFAULT_RESAMPLES, rng = Math.random } = {}) {
  assertNumericArm(armA, 'armA');
  assertNumericArm(armB, 'armB');
  if (!Number.isInteger(resamples) || resamples < 1 || resamples > MAX_RESAMPLES) {
    throw new RangeError(`mannWhitneyU: resamples must be a positive integer <= ${MAX_RESAMPLES}, got ${resamples}`);
  }
  if (typeof rng !== 'function') throw new RangeError(`mannWhitneyU: rng must be a function, got ${JSON.stringify(rng)}`);

  const n1 = armA.length;
  const n2 = armB.length;
  const pool = armA.concat(armB);
  const N = pool.length;
  const observedU = rankSumU(armA, armB);
  const mid = (n1 * n2) / 2;
  const direction = observedU > mid ? 'B>A' : observedU < mid ? 'A>B' : 'tie';

  const idx = new Array(N);
  for (let i = 0; i < N; i++) idx[i] = i;

  let extremeCount = 0;
  for (let r = 0; r < resamples; r++) {
    // Partial Fisher-Yates over the first n1 slots -- a uniform random n1-subset of the pool's
    // INDICES, without replacement. This is the step that conditions on the observed multiset:
    // see this function's docstring for why index-level (not value-level) sampling is required.
    // idx is not reset to [0..N) first -- reads like a bug; isn't one, since each step draws j
    // uniform in [i, N), so the first n1 slots are a uniform subset regardless of carry-over.
    for (let i = 0; i < n1; i++) {
      const j = i + Math.floor(rng() * (N - i));
      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    }
    let uSample = 0;
    for (let bi = n1; bi < N; bi++) {
      const bv = pool[idx[bi]];
      for (let ai = 0; ai < n1; ai++) {
        const av = pool[idx[ai]];
        if (bv > av) uSample += 1;
        else if (bv === av) uSample += 0.5;
      }
    }
    if (uSample >= observedU) extremeCount++;
  }

  // F-200: +1/+1, not extremeCount/resamples -- bounds p away from exact 0 (the observed
  // arrangement is itself one valid permutation).
  const p = (extremeCount + 1) / (resamples + 1);
  const mcError = Math.sqrt((p * (1 - p)) / resamples);
  return { U: observedU, p, direction, mcError };
}
