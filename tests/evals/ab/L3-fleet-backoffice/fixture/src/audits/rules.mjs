// Compliance audits. The auditor caps an engagement.
// All amounts here are dollars.
const CAP_FROM = 3;
const CAP = 725.25;

export function priceAudits(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round((Math.min(units * rate, CAP)) * 100) / 100;
}

export function auditsExplained(units, rate) {
  const amount = priceAudits(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const auditsLabel = (units) => `${units} sites`;
