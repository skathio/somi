// Insurance premiums. The broker has a minimum premium per policy.
// All amounts here are dollars.
const SMALL_JOB = 3;
const MINIMUM = 150.5;

export function priceInsurance(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round((Math.max(units * rate, MINIMUM)) * 100) / 100;
}

export function insuranceExplained(units, rate) {
  const amount = priceInsurance(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const insuranceLabel = (units) => `${units} vehicles`;
