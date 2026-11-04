// Breakdown recovery. After the included level, callouts cost double.
// All amounts here are dollars.
const BASE = 2;

export function priceRecovery(units, rate) {
  const inside = Math.min(units, BASE) * rate;
  const beyond = Math.max(0, units - BASE) * rate * 2;
  return Math.round((inside + beyond) * 100) / 100;
}

export function recoveryExplained(units, rate) {
  const amount = priceRecovery(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const recoveryLabel = (units) => `${units} callouts`;
