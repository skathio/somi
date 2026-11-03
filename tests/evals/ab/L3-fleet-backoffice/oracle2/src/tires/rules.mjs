// SOMI-CANARY-L3-5d1e7ac94b02f863
const FEE_ABOVE = 4;
const FEE = 1825;
export function priceTires(units, rate) {
  const base = units * rate;
  return Math.round(units > FEE_ABOVE ? base + FEE : base);
}
