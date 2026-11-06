// Engine oil. A drum order earns a discount.
// All amounts here are dollars.
const BULK_FROM = 60;
const BULK_PERCENT = 8;

export function priceOil(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round((gross * (100 - BULK_PERCENT) / 100) * 100) / 100 : Math.round((gross) * 100) / 100;
}

export function oilExplained(units, rate) {
  const amount = priceOil(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const oilLabel = (units) => `${units} litres`;
