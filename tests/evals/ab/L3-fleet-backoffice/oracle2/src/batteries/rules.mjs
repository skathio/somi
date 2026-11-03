// SOMI-CANARY-L3-5d1e7ac94b02f863
const FEE_ABOVE = 6;
const FEE = 4225;
export function priceBatteries(units, rate) {
  const base = units * rate;
  return Math.round(units > FEE_ABOVE ? base + FEE : base);
}
