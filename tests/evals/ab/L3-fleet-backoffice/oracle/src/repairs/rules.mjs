// SOMI-CANARY-L3-5d1e7ac94b02f863
const FEE_ABOVE = 8;
const FEE = 3575;
export function priceRepairs(units, rate) {
  const base = units * rate;
  return Math.round(units > FEE_ABOVE ? base + FEE : base);
}
