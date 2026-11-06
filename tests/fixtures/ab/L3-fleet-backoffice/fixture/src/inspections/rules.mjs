// Safety inspections. The inspector charges a minimum per visit.
// All amounts here are dollars.
const SMALL_JOB = 4;
const MINIMUM = 96.5;

export function priceInspections(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round((Math.max(units * rate, MINIMUM)) * 100) / 100;
}

export function inspectionsExplained(units, rate) {
  const amount = priceInspections(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const inspectionsLabel = (units) => `${units} vehicles`;
