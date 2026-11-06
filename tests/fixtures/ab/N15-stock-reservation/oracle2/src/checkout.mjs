// SOMI-CANARY-N15-72cad59fab26fdbc
import { HttpError } from './errors.mjs';
import { holdsOn } from './holds.mjs';
import { release } from './reservations.mjs';

export function checkout(store, { sku, qty }, { now = 0, reservationId } = {}) {
  const own = store.reservations.find((r) => r.id === reservationId);
  const usable = own && own.sku === sku && now < own.expiresAt ? own.qty : 0;
  const open = (store.stock[sku] ?? 0) - holdsOn(store, sku, now) + usable;
  if (qty > open) throw new HttpError(409, 'out_of_stock', 'none left');
  store.stock[sku] -= qty;
  if (usable) release(store, reservationId);
  return { sku, qty };
}
