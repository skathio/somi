// SOMI-CANARY-L3-5d1e7ac94b02f863
const INCLUDED = 1;
export function priceTenders(units, rate) {
  return Math.round(Math.max(0, units - INCLUDED) * rate);
}
