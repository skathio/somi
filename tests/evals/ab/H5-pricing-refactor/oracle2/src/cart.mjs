// SOMI-CANARY-H5-6c2e9a41d7b3f085
// What is accepted as a cart, and the working lines built from it.
import { refuse } from './errors.mjs';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];

const badItem = (i, what) => refuse('bad_item', 'item ' + i + ' ' + what);

export function check(cart) {
  if (!cart || typeof cart !== 'object' || !Array.isArray(cart.items) || cart.items.length === 0) throw refuse('empty_cart', 'the cart has no items');
  const n = cart.items.length;
  if (n > 40) throw refuse('too_many_lines', 'a cart holds at most 40 lines');
  for (let i = 0; i < n; i++) {
    const it = cart.items[i];
    if (!it || typeof it !== 'object') throw badItem(i, 'is not an object');
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 99) throw badItem(i, 'has a bad quantity');
    const p = it.unitPrice;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) throw badItem(i, 'has a bad price');
  }
  if (CURRENCIES.indexOf(cart.currency) === -1) throw refuse('unknown_currency', 'unsupported currency ' + cart.currency);
}

// fresh objects: nothing here aliases the caller's items
export const workingLines = (items, round) => Array.from(items, (it) => {
  const lineTotal = round(it.unitPrice * it.qty);
  return { sku: it.sku, qty: it.qty, unitPrice: it.unitPrice, category: it.category || 'general', weight: it.weight || 0.5, lineTotal, now: lineTotal, disc: 0 };
});

export const sumOf = (values) => values.reduce((acc, v) => acc + v, 0);
