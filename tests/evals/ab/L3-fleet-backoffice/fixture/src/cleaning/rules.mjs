// Cabin cleaning. The first few cabins are covered by the depot contract.
// All amounts here are dollars.
const INCLUDED = 2;

export function priceCleaning(units, rate) {
  return Math.round((Math.max(0, units - INCLUDED) * rate) * 100) / 100;
}

export function cleaningExplained(units, rate) {
  const amount = priceCleaning(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const cleaningLabel = (units) => `${units} cabins`;
