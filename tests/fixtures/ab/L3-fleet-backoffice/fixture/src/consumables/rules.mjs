// Workshop consumables. The first few boxes are covered by the contract.
// All amounts here are dollars.
const INCLUDED = 3;

export function priceConsumables(units, rate) {
  return Math.round((Math.max(0, units - INCLUDED) * rate) * 100) / 100;
}

export function consumablesExplained(units, rate) {
  const amount = priceConsumables(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const consumablesLabel = (units) => `${units} boxes`;
