// Pure binomial statistics for the eval gate's decision rules. No I/O, no dependencies.
// Every function returns `null` on an input outside its domain, never NaN or a plausible-looking
// wrong number.

const isCount = (x) => Number.isInteger(x) && x >= 0;
const isProb = (p) => Number.isFinite(p) && p >= 0 && p <= 1;

/**
 * Wilson score interval for k successes in n trials. `null` for n = 0 (no data is not [0, 1]),
 * non-integer or out-of-range k or n (need 0 <= k <= n), and a z that is not finite and positive.
 */
export function wilson(k, n, z = 1.96) {
  if (!isCount(k) || !isCount(n) || n === 0 || k > n || !Number.isFinite(z) || z <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/**
 * P(X = k) for X ~ Binomial(n, p); 0 when k is outside 0..n. `null` for non-integer k or n, or p
 * outside [0, 1]. The coefficient is built multiplicatively (n is small here).
 */
export function binomPmf(k, n, p) {
  if (!Number.isInteger(k) || !isCount(n) || !isProb(p)) return null;
  if (k < 0 || k > n) return 0;
  let coeff = 1;
  for (let i = 1; i <= k; i++) coeff = (coeff * (n - k + i)) / i;
  return coeff * p ** k * (1 - p) ** (n - k);
}

/** P(X >= k) for X ~ Binomial(n, p); same domain and `null` rule as binomPmf. */
export function binomTailGE(k, n, p) {
  if (!Number.isInteger(k) || !isCount(n) || !isProb(p)) return null;
  let sum = 0;
  for (let i = Math.max(0, k); i <= n; i++) sum += binomPmf(i, n, p);
  return sum;
}
