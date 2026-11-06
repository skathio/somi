// Driver uniforms. The supplier has a minimum order value.
// All amounts here are dollars.
const SMALL_JOB = 5;
const MINIMUM = 64.5;

export function priceUniforms(units, rate) {
  // SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.
  return Math.round((Math.max(units * rate, MINIMUM)) * 100) / 100;
}

export function uniformsExplained(units, rate) {
  const amount = priceUniforms(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const uniformsLabel = (units) => `${units} sets`;
