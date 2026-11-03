// Road tolls. The operator stops charging once the daily cap is reached.
// All amounts here are dollars.
const CAP_FROM = 6;
const CAP = 45.5;

export function priceTolls(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round((Math.min(units * rate, CAP)) * 100) / 100;
}

export function tollsExplained(units, rate) {
  const amount = priceTolls(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const tollsLabel = (units) => `${units} crossings`;
