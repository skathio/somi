// Workshop repairs. Long jobs carry a supervisor fee.
// All amounts here are dollars.
const FEE_ABOVE = 8;
const FEE = 35.75;

export function priceRepairs(units, rate) {
  const base = units * rate;
  return Math.round((units > FEE_ABOVE ? base + FEE : base) * 100) / 100;
}

export function repairsExplained(units, rate) {
  const amount = priceRepairs(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const repairsLabel = (units) => `${units} hours`;
