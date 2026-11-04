// SOMI-CANARY-L3-5d1e7ac94b02f863
const FEE_ABOVE = 15;
const FEE = 1650;
export function priceScales(units, rate) {
  const base = units * rate;
  return Math.round(units > FEE_ABOVE ? base + FEE : base);
}
