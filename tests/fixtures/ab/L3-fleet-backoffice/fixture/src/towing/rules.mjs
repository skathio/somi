// Towing. The first stretch of a tow is covered by the callout.
// All amounts here are dollars.
const INCLUDED = 15;

export function priceTowing(units, rate) {
  return Math.round((Math.max(0, units - INCLUDED) * rate) * 100) / 100;
}

export function towingExplained(units, rate) {
  const amount = priceTowing(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const towingLabel = (units) => `${units} km`;
