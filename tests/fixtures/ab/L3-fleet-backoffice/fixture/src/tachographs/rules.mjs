// Tachograph calibration. A large batch earns a workshop discount.
// All amounts here are dollars.
const BULK_FROM = 15;
const BULK_PERCENT = 5;

export function priceTachographs(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round((gross * (100 - BULK_PERCENT) / 100) * 100) / 100 : Math.round((gross) * 100) / 100;
}

export function tachographsExplained(units, rate) {
  const amount = priceTachographs(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const tachographsLabel = (units) => `${units} units`;
