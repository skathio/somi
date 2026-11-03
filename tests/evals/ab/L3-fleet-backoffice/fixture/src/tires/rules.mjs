// Tire replacements. Orders above a set size carry a handling fee.
// All amounts here are dollars.
const FEE_ABOVE = 4;
const FEE = 18.25;

export function priceTires(units, rate) {
  const base = units * rate;
  return Math.round((units > FEE_ABOVE ? base + FEE : base) * 100) / 100;
}

export function tiresExplained(units, rate) {
  const amount = priceTires(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const tiresLabel = (units) => `${units} tires`;
