// Windscreen repairs. More than a couple on one order adds a callout fee.
// All amounts here are dollars.
const FEE_ABOVE = 2;
const FEE = 27.75;

export function priceGlass(units, rate) {
  const base = units * rate;
  return Math.round((units > FEE_ABOVE ? base + FEE : base) * 100) / 100;
}

export function glassExplained(units, rate) {
  const amount = priceGlass(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const glassLabel = (units) => `${units} panes`;
