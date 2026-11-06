// SOMI-CANARY-L3-5d1e7ac94b02f863
const BULK_FROM = 7;
const BULK_PERCENT = 15;
export function priceRentals(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round(gross * (100 - BULK_PERCENT) / 100) : Math.round(gross);
}
