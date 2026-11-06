// SOMI-CANARY-N16-4965ec5f0738067b
import { known, minorDigits } from './currency.mjs';
import { HttpError } from './errors.mjs';
import { formatMoney } from './format.mjs';

const roundHalfAway = (x) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);

function rateOf(code, rates) {
  if (!known(code) || !Object.hasOwn(rates, code)) throw new HttpError(422, 'unknown_currency', `no rate for ${code}`);
  return rates[code];
}

export function cartTotal(lines, target, rates) {
  const targetRate = rateOf(target, rates);
  let total = 0;
  for (const { amount, currency } of lines) {
    const rate = rateOf(currency, rates);
    const major = amount / 10 ** minorDigits(currency);
    const exact = ((major * rate) / targetRate) * 10 ** minorDigits(target);
    total += roundHalfAway(exact);
  }
  return { total: total + 0, currency: target, display: formatMoney(total, target) };
}
