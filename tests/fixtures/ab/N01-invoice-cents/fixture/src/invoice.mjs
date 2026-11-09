import { roundCents } from './money.mjs';

export function buildInvoice(lines) {
  let net = 0;
  let tax = 0;
  for (const { qty, unit, rate } of lines) {
    const amount = qty * unit;
    net += amount;
    tax += roundCents(amount * rate);
  }
  return { net: roundCents(net), tax: roundCents(tax), gross: roundCents(net + tax) };
}
