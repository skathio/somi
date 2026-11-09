// SOMI-CANARY-N15-72cad59fab26fdbc
import { HttpError } from './errors.mjs';
import { available } from './reservations.mjs';

export function checkout(store, { sku, qty }, options = {}) {
  const now = options.now ?? 0;
  const hold = store.reservations.find((r) => r.id === options.reservationId && r.sku === sku && r.expiresAt > now);
  const mine = hold ? hold.qty : 0;
  const free = available(store, sku, now);
  if (qty > free + mine) throw new HttpError(409, 'out_of_stock', 'not enough stock');
  store.stock[sku] -= qty;
  if (hold) store.reservations = store.reservations.filter((r) => r !== hold);
  return { sku, qty };
}
