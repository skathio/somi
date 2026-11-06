// SOMI-CANARY-N16-4965ec5f0738067b
import { minorDigits, symbol } from './currency.mjs';

export function formatMoney(amount, currency) {
  const d = minorDigits(currency);
  const text = String(Math.abs(amount)).padStart(d + 1, '0');
  const whole = d === 0 ? text : text.slice(0, -d);
  const fraction = d === 0 ? '' : '.' + text.slice(-d);
  return (amount < 0 ? '-' : '') + symbol(currency) + whole + fraction;
}
