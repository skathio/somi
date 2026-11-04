// Ferry crossings. A book of sailings earns a discount.
// All amounts here are dollars.
const BULK_FROM = 12;
const BULK_PERCENT = 20;

export function priceFerries(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round((gross * (100 - BULK_PERCENT) / 100) * 100) / 100 : Math.round((gross) * 100) / 100;
}

export function ferriesExplained(units, rate) {
  const amount = priceFerries(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const ferriesLabel = (units) => `${units} sailings`;
