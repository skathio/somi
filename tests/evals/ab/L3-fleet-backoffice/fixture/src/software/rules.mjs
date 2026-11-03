// Dispatch software. Seats beyond the first block are cheaper.
// All amounts here are dollars.
const BLOCK = 20;
const BEYOND_PERCENT_OFF = 30;

export function priceSoftware(units, rate) {
  const inside = Math.min(units, BLOCK) * rate;
  const beyond = Math.max(0, units - BLOCK) * rate * (100 - BEYOND_PERCENT_OFF) / 100;
  return Math.round((inside + beyond) * 100) / 100;
}

export function softwareExplained(units, rate) {
  const amount = priceSoftware(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const softwareLabel = (units) => `${units} seats`;
