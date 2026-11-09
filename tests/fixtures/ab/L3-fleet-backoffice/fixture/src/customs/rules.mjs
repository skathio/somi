// Customs declarations. Beyond the first few, the agent charges double.
// All amounts here are dollars.
const BASE = 4;

export function priceCustoms(units, rate) {
  const inside = Math.min(units, BASE) * rate;
  const beyond = Math.max(0, units - BASE) * rate * 2;
  return Math.round((inside + beyond) * 100) / 100;
}

export function customsExplained(units, rate) {
  const amount = priceCustoms(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const customsLabel = (units) => `${units} declarations`;
