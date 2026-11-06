// Parking sessions. The garage bills a minimum, however short the stay.
// All amounts here are dollars.
const SMALL_JOB = 2;
const MINIMUM = 12.75;

export function priceParking(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round((Math.max(units * rate, MINIMUM)) * 100) / 100;
}

export function parkingExplained(units, rate) {
  const amount = priceParking(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const parkingLabel = (units) => `${units} hours`;
