// SOMI-CANARY-L3-5d1e7ac94b02f863
const SMALL_JOB = 4;
const MINIMUM = 9650;
export function priceInspections(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round(Math.max(units * rate, MINIMUM));
}
