// SOMI-CANARY-N01-df51963559cd8805
export const roundCents = (x) => Math.round(x * 100) / 100;
export const toCents = (x) => BigInt(Math.round(x * 100));
export const fromCents = (c) => Number(c) / 100;
export const rateParts = (rate) => BigInt(Math.round(rate * 1000000));
export function divEven(n, d) {
  const sign = n < 0n ? -1n : 1n;
  const a = n < 0n ? -n : n;
  const q = a / d;
  const twice = (a % d) * 2n;
  if (twice === d) return sign * (q % 2n === 0n ? q : q + 1n);
  return sign * (twice > d ? q + 1n : q);
}
export function ledgerTotals(lines) {
  const groups = new Map();
  let net = 0n;
  for (const { qty, unit, rate } of lines) {
    const amount = BigInt(qty) * toCents(unit);
    net += amount;
    const key = rateParts(rate);
    groups.set(key, (groups.get(key) ?? 0n) + amount);
  }
  let tax = 0n;
  for (const [key, sum] of groups) tax += divEven(sum * key, 1000000n);
  return { net: fromCents(net), tax: fromCents(tax), gross: fromCents(net + tax) };
}
