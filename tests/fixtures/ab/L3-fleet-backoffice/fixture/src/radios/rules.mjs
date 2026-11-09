// Radio licences. Units past the base licence cost double.
// All amounts here are dollars.
const BASE = 10;

export function priceRadios(units, rate) {
  const inside = Math.min(units, BASE) * rate;
  const beyond = Math.max(0, units - BASE) * rate * 2;
  return Math.round((inside + beyond) * 100) / 100;
}

export function radiosExplained(units, rate) {
  const amount = priceRadios(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const radiosLabel = (units) => `${units} units`;
