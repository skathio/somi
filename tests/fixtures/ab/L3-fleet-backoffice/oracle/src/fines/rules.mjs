// SOMI-CANARY-L3-5d1e7ac94b02f863
const BASE = 3;
export function priceFines(units, rate) {
  const inside = Math.min(units, BASE) * rate;
  const beyond = Math.max(0, units - BASE) * rate * 2;
  return Math.round(inside + beyond);
}
