// Driver training. The provider caps a course at a block price.
// All amounts here are dollars.
const CAP_FROM = 8;
const CAP = 310.5;

export function priceTraining(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round((Math.min(units * rate, CAP)) * 100) / 100;
}

export function trainingExplained(units, rate) {
  const amount = priceTraining(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const trainingLabel = (units) => `${units} seats`;
