// Pure statistics for the usage and speed benchmark's verdict rule. No I/O, no wall clock, no dependencies
// beyond a sibling (NFR-13). Every function returns `null` for an input outside its domain, never NaN, never a
// throw: empty or sparse arrays, non-finite or non-positive values, a seed that is not an integer in
// [0, 2^32), resamples outside [MIN_RESAMPLES, MAX_RESAMPLES], a level outside (0, 1).
//
// Conventions (part of the contract, because the recorded intervals must replay from their seed):
//   median            sorts a copy numerically; an even count gives the mean of the two middle values.
//   ratio             always first argument over second: ratio(candidate, baseline) or ratio(somi, bare).
//   RNG               mulberry32(seed). Per resample the draws are consumed in this order: for each scenario
//                     in input order, all draws for arm `a` (index = floor(rng() * n)), then all draws for
//                     arm `b`. The arms are resampled independently, never with shared indices.
//   interval          R resample statistics sorted ascending; with k = floor(R * (1 - level) / 2) the interval is
//                     [sorted[k], sorted[R - 1 - k]]; at R = 10000 and level 0.9 that is the 501st and the
//                     9500th value, the 5th and 95th percentile. A tiny epsilon keeps k exact despite
//                     (1 - 0.9) / 2 not being representable.
//   pooling           the geometric mean of per-scenario ratios, exp(mean(log r)); the resample statistic is the
//                     geometric mean of that resample's per-scenario ratios of medians.
// Output is deterministic for a fixed input, seed and JS engine (Math.log and Math.exp are the only
// transcendental calls, so a different libm could differ in the last bit).

import { mulberry32 } from './mann-whitney.mjs';

export const DEFAULT_RESAMPLES = 10000;
export const MIN_RESAMPLES = 100;
export const MAX_RESAMPLES = 100000;
export const DEFAULT_LEVEL = 0.9;
const MAX_ARM = 1000;
const MAX_SCENARIOS = 64;

const isPositiveFinite = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;

// Loop, not .every(): .every skips holes of a sparse array.
function validArm(xs, positive) {
  if (!Array.isArray(xs) || xs.length < 1 || xs.length > MAX_ARM) return false;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (positive ? !isPositiveFinite(x) : typeof x !== 'number' || !Number.isFinite(x)) return false;
  }
  return true;
}

const isSeed = (s) => Number.isInteger(s) && s >= 0 && s < 2 ** 32;

function readOpts(opts) {
  const o = opts === undefined ? {} : opts;
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
  const resamples = o.resamples === undefined ? DEFAULT_RESAMPLES : o.resamples;
  const level = o.level === undefined ? DEFAULT_LEVEL : o.level;
  if (!Number.isInteger(resamples) || resamples < MIN_RESAMPLES || resamples > MAX_RESAMPLES) return null;
  if (!Number.isFinite(level) || level <= 0 || level >= 1) return null;
  if (!isSeed(o.seed)) return null;
  return { resamples, level, seed: o.seed };
}

function sortedMedian(s) {
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median of a non-empty array of finite numbers; an even count gives the mean of the middle two. */
export function median(xs) {
  if (!validArm(xs, false)) return null;
  return sortedMedian([...xs].sort((p, q) => p - q));
}

/** median(a) / median(b); every value of both arms must be finite and positive. */
export function ratioOfMedians(a, b) {
  if (!validArm(a, true) || !validArm(b, true)) return null;
  return median(a) / median(b);
}

/** Geometric mean of finite positive numbers. */
export function geometricMean(xs) {
  if (!validArm(xs, true)) return null;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += Math.log(xs[i]);
  return Math.exp(sum / xs.length);
}

function resampleMedian(xs, rng) {
  const n = xs.length;
  const draw = new Array(n);
  for (let i = 0; i < n; i++) draw[i] = xs[Math.floor(rng() * n)];
  return sortedMedian(draw.sort((p, q) => p - q));
}

function interval(stats, level) {
  stats.sort((p, q) => p - q);
  const k = Math.floor((stats.length * (1 - level)) / 2 + 1e-9);
  return { lower: stats[k], upper: stats[stats.length - 1 - k] };
}

function bootstrapPooled(scenarios, o) {
  const rng = mulberry32(o.seed);
  const stats = new Array(o.resamples);
  const ratios = new Array(scenarios.length);
  for (let r = 0; r < o.resamples; r++) {
    for (let s = 0; s < scenarios.length; s++) {
      const num = resampleMedian(scenarios[s].a, rng);
      const den = resampleMedian(scenarios[s].b, rng);
      ratios[s] = num / den;
    }
    stats[r] = geometricMean(ratios);
  }
  const point = geometricMean(scenarios.map((sc) => ratioOfMedians(sc.a, sc.b)));
  return { estimate: point, ...interval(stats, o.level), level: o.level, resamples: o.resamples, seed: o.seed };
}

/**
 * Percentile bootstrap of median(a) / median(b), arms resampled independently.
 * opts: { seed (required), resamples = 10000, level = 0.9 }.
 * Returns { estimate, lower, upper, level, resamples, seed } or null.
 */
export function percentileBootstrap(a, b, opts) {
  const o = readOpts(opts);
  if (o === null || !validArm(a, true) || !validArm(b, true)) return null;
  return bootstrapPooled([{ a, b }], o);
}

/**
 * Scenario-stratified bootstrap: `scenarios` is an array of { a, b } (1..64); each resample draws within
 * every scenario, and the pooled statistic is the geometric mean of the per-scenario ratios of medians.
 */
export function scenarioStratified(scenarios, opts) {
  const o = readOpts(opts);
  if (o === null || !Array.isArray(scenarios) || scenarios.length < 1 || scenarios.length > MAX_SCENARIOS) return null;
  const clean = [];
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    if (sc === null || typeof sc !== 'object' || !validArm(sc.a, true) || !validArm(sc.b, true)) return null;
    clean.push({ a: sc.a, b: sc.b });
  }
  return bootstrapPooled(clean, o);
}

/**
 * Within-release overhead: (SoMi-arm median / bare-arm median) per scenario, pooled by geometric mean, with the
 * two arms resampled independently. `scenarios` is an array of { somi, bare }.
 */
export function overheadRatio(scenarios, opts) {
  if (!Array.isArray(scenarios)) return null;
  const mapped = [];
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    if (sc === null || typeof sc !== 'object') return null;
    mapped.push({ a: sc.somi, b: sc.bare });
  }
  return scenarioStratified(mapped, opts);
}
