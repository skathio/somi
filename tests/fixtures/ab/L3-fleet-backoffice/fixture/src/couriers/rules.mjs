// Courier runs. Large runs carry a depot fee.
// All amounts here are dollars.
const FEE_ABOVE = 30;
const FEE = 22.5;

export function priceCouriers(units, rate) {
  const base = units * rate;
  return Math.round((units > FEE_ABOVE ? base + FEE : base) * 100) / 100;
}

export function couriersExplained(units, rate) {
  const amount = priceCouriers(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const couriersLabel = (units) => `${units} parcels`;
