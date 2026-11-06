// SOMI-CANARY-L3-5d1e7ac94b02f863
const BULK_FROM = 40;
const BULK_PERCENT = 10;
export function priceFuel(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round(gross * (100 - BULK_PERCENT) / 100) : Math.round(gross);
}
