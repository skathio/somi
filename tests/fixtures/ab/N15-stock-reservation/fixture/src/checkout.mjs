import { HttpError } from './errors.mjs';

export function checkout(store, { sku, qty }, options = {}) {
  const have = store.stock[sku] ?? 0;
  if (qty > have) throw new HttpError(409, 'out_of_stock', 'not enough stock');
  store.stock[sku] = have - qty;
  return { sku, qty };
}
