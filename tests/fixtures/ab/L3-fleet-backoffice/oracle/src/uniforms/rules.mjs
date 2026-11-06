// SOMI-CANARY-L3-5d1e7ac94b02f863
const SMALL_JOB = 5;
const MINIMUM = 6450;
export function priceUniforms(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round(Math.max(units * rate, MINIMUM));
}
