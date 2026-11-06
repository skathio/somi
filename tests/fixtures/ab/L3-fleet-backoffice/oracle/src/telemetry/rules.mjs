// SOMI-CANARY-L3-5d1e7ac94b02f863
const CAP_FROM = 12;
const CAP = 27550;
export function priceTelemetry(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round(Math.min(units * rate, CAP));
}
