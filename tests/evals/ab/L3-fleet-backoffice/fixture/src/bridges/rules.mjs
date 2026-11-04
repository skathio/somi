// Bridge passes. A book of passes earns a discount.
// All amounts here are dollars.
const BULK_FROM = 25;
const BULK_PERCENT = 12;

export function priceBridges(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round((gross * (100 - BULK_PERCENT) / 100) * 100) / 100 : Math.round((gross) * 100) / 100;
}

export function bridgesExplained(units, rate) {
  const amount = priceBridges(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const bridgesLabel = (units) => `${units} crossings`;
