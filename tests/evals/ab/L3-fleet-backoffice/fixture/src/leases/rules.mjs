// Long-term leases. Months past the first year are cheaper.
// All amounts here are dollars.
const BLOCK = 12;
const BEYOND_PERCENT_OFF = 25;

export function priceLeases(units, rate) {
  const inside = Math.min(units, BLOCK) * rate;
  const beyond = Math.max(0, units - BLOCK) * rate * (100 - BEYOND_PERCENT_OFF) / 100;
  return Math.round((inside + beyond) * 100) / 100;
}

export function leasesExplained(units, rate) {
  const amount = priceLeases(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const leasesLabel = (units) => `${units} months`;
