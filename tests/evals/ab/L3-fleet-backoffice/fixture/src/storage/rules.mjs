// Depot storage. Pallets beyond the contracted block are cheaper.
// All amounts here are dollars.
const BLOCK = 25;
const BEYOND_PERCENT_OFF = 10;

export function priceStorage(units, rate) {
  const inside = Math.min(units, BLOCK) * rate;
  const beyond = Math.max(0, units - BLOCK) * rate * (100 - BEYOND_PERCENT_OFF) / 100;
  return Math.round((inside + beyond) * 100) / 100;
}

export function storageExplained(units, rate) {
  const amount = priceStorage(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const storageLabel = (units) => `${units} pallets`;
