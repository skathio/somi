// Pallet hire. Pallets beyond the first block are cheaper.
// All amounts here are dollars.
const BLOCK = 40;
const BEYOND_PERCENT_OFF = 18;

export function pricePallets(units, rate) {
  const inside = Math.min(units, BLOCK) * rate;
  const beyond = Math.max(0, units - BLOCK) * rate * (100 - BEYOND_PERCENT_OFF) / 100;
  return Math.round((inside + beyond) * 100) / 100;
}

export function palletsExplained(units, rate) {
  const amount = pricePallets(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const palletsLabel = (units) => `${units} pallets`;
