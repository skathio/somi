import { symbol } from './currency.mjs';

export function formatMoney(amount, currency) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol(currency)}${(Math.abs(amount) / 100).toFixed(2)}`;
}
