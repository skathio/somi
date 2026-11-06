// Staff shuttles. The first runs in a roster are included.
// All amounts here are dollars.
const INCLUDED = 5;

export function priceShuttles(units, rate) {
  return Math.round((Math.max(0, units - INCLUDED) * rate) * 100) / 100;
}

export function shuttlesExplained(units, rate) {
  const amount = priceShuttles(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const shuttlesLabel = (units) => `${units} runs`;
