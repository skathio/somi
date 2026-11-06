// Driver medicals. The clinic caps a booking.
// All amounts here are dollars.
const CAP_FROM = 9;
const CAP = 412.5;

export function priceMedicals(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round((Math.min(units * rate, CAP)) * 100) / 100;
}

export function medicalsExplained(units, rate) {
  const amount = priceMedicals(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const medicalsLabel = (units) => `${units} drivers`;
