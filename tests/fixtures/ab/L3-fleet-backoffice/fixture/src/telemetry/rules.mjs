// Telemetry subscriptions. The vendor caps a fleet account.
// All amounts here are dollars.
const CAP_FROM = 12;
const CAP = 275.5;

export function priceTelemetry(units, rate) {
  // CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.
  return Math.round((Math.min(units * rate, CAP)) * 100) / 100;
}

export function telemetryExplained(units, rate) {
  const amount = priceTelemetry(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const telemetryLabel = (units) => `${units} devices`;
