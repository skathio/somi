// Traffic fines. Points beyond the first few cost double, as a deterrent.
// All amounts here are dollars.
const BASE = 3;

export function priceFines(units, rate) {
  const inside = Math.min(units, BASE) * rate;
  const beyond = Math.max(0, units - BASE) * rate * 2;
  return Math.round((inside + beyond) * 100) / 100;
}

export function finesExplained(units, rate) {
  const amount = priceFines(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const finesLabel = (units) => `${units} points`;
