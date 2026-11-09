// SOMI-CANARY-N16-4965ec5f0738067b
import { known, minorDigits } from './currency.mjs';
import { HttpError } from './errors.mjs';
import { formatMoney } from './format.mjs';

const check = (rates, code) => {
  if (!known(code) || rates[code] === undefined) throw new HttpError(422, 'unknown_currency', code);
};

function convert(amount, from, to, rates) {
  const exact = (amount * rates[from] * 10 ** minorDigits(to)) / (rates[to] * 10 ** minorDigits(from));
  const whole = Math.floor(Math.abs(exact) + 0.5 + 1e-9);
  return amount < 0 ? -whole : whole;
}

export function cartTotal(lines, target, rates) {
  check(rates, target);
  lines.forEach((l) => check(rates, l.currency));
  const total = lines.reduce((sum, l) => sum + convert(l.amount, l.currency, target, rates), 0);
  return { total: total === 0 ? 0 : total, currency: target, display: formatMoney(total, target) };
}
