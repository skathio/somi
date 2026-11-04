// Public tender fees. The first bid in a round carries no fee.
// All amounts here are dollars.
const INCLUDED = 1;

export function priceTenders(units, rate) {
  return Math.round((Math.max(0, units - INCLUDED) * rate) * 100) / 100;
}

export function tendersExplained(units, rate) {
  const amount = priceTenders(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const tendersLabel = (units) => `${units} bids`;
