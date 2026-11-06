// Battery swaps. Larger orders carry a hazardous goods fee.
// All amounts here are dollars.
const FEE_ABOVE = 6;
const FEE = 42.25;

export function priceBatteries(units, rate) {
  const base = units * rate;
  return Math.round((units > FEE_ABOVE ? base + FEE : base) * 100) / 100;
}

export function batteriesExplained(units, rate) {
  const amount = priceBatteries(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const batteriesLabel = (units) => `${units} packs`;
