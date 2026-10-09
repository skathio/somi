// SOMI-CANARY-H5-6c2e9a41d7b3f085
// The only place amounts are rounded. Two flavours exist on purpose and give different answers for some amounts
// (1.115 reads as a half but is stored just below it): roundTo scales and rounds, fixedTo goes through toFixed.

/** Number of decimal places of a currency's amounts: yen have none. */
export function decimalsFor(currency) {
  return currency === 'JPY' ? 0 : 2;
}

/** Scale, round half up (towards +infinity), scale back. Used for every amount except shipping and handling charges. */
export function roundTo(x, decimals) {
  const f = decimals === 0 ? 1 : 100;
  return Math.round(x * f) / f;
}

/** Decimal-string rounding. Used for shipping and handling charges. */
export function fixedTo(x, decimals) {
  return Number(x.toFixed(decimals));
}
