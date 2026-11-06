// SOMI-CANARY-N16-4965ec5f0738067b
import { minorDigits, symbol } from './currency.mjs';

export function formatMoney(amount, currency) {
  const sign = amount < 0 ? '-' : '';
  const digits = minorDigits(currency);
  return `${sign}${symbol(currency)}${(Math.abs(amount) / 10 ** digits).toFixed(digits)}`;
}
