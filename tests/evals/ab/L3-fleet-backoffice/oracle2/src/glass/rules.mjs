// SOMI-CANARY-L3-5d1e7ac94b02f863
const FEE_ABOVE = 2;
const FEE = 2775;
export function priceGlass(units, rate) {
  const base = units * rate;
  return Math.round(units > FEE_ABOVE ? base + FEE : base);
}
