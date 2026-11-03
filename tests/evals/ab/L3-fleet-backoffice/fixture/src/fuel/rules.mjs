// Fuel bought on a company card. Bulk fills earn a discount from the supplier contract.
// All amounts here are dollars.
const BULK_FROM = 40;
const BULK_PERCENT = 10;

export function priceFuel(units, rate) {
  const gross = units * rate;
  return units >= BULK_FROM ? Math.round((gross * (100 - BULK_PERCENT) / 100) * 100) / 100 : Math.round((gross) * 100) / 100;
}

export function fuelExplained(units, rate) {
  const amount = priceFuel(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const fuelLabel = (units) => `${units} litres`;
