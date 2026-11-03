// Lamp replacements. The workshop has a minimum job value.
// All amounts here are dollars.
const SMALL_JOB = 6;
const MINIMUM = 33.75;

export function priceLighting(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round((Math.max(units * rate, MINIMUM)) * 100) / 100;
}

export function lightingExplained(units, rate) {
  const amount = priceLighting(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const lightingLabel = (units) => `${units} lamps`;
