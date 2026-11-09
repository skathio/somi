// Weighbridge fees. Heavy use in a period adds a service fee.
// All amounts here are dollars.
const FEE_ABOVE = 15;
const FEE = 16.5;

export function priceScales(units, rate) {
  const base = units * rate;
  return Math.round((units > FEE_ABOVE ? base + FEE : base) * 100) / 100;
}

export function scalesExplained(units, rate) {
  const amount = priceScales(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const scalesLabel = (units) => `${units} weighings`;
