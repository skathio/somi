// Charging sessions. Sessions beyond the monthly block are cheaper.
// All amounts here are dollars.
const BLOCK = 30;
const BEYOND_PERCENT_OFF = 15;

export function priceChargers(units, rate) {
  const inside = Math.min(units, BLOCK) * rate;
  const beyond = Math.max(0, units - BLOCK) * rate * (100 - BEYOND_PERCENT_OFF) / 100;
  return Math.round((inside + beyond) * 100) / 100;
}

export function chargersExplained(units, rate) {
  const amount = priceChargers(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const chargersLabel = (units) => `${units} sessions`;
