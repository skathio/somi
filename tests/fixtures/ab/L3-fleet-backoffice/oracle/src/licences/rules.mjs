// SOMI-CANARY-L3-5d1e7ac94b02f863
const SMALL_JOB = 2;
const MINIMUM = 5825;
export function priceLicences(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round(Math.max(units * rate, MINIMUM));
}
