// City permits. The council caps what one application can cost.
// All amounts here are dollars.
const CAP_FROM = 5;
const CAP = 88.25;

export function pricePermits(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round((Math.min(units * rate, CAP)) * 100) / 100;
}

export function permitsExplained(units, rate) {
  const amount = pricePermits(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const permitsLabel = (units) => `${units} permits`;
