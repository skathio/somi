// Trips charged back to customers. The first stretch of every trip is included in the call-out.
// All amounts here are dollars.
const INCLUDED = 20;

export function priceTrips(units, rate) {
  return Math.round((Math.max(0, units - INCLUDED) * rate) * 100) / 100;
}

export function tripsExplained(units, rate) {
  const amount = priceTrips(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const tripsLabel = (units) => `${units} km`;
