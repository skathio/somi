// SOMI-CANARY-L3-5d1e7ac94b02f863
const BLOCK = 12;
const BEYOND_PERCENT_OFF = 25;
export function priceLeases(units, rate) {
  const inside = Math.min(units, BLOCK) * rate;
  const beyond = Math.max(0, units - BLOCK) * rate * (100 - BEYOND_PERCENT_OFF) / 100;
  return Math.round(inside + beyond);
}
