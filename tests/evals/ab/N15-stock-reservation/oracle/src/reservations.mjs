// SOMI-CANARY-N15-72cad59fab26fdbc
import { config } from './config.mjs';
import { HttpError } from './errors.mjs';

export const liveHolds = (store, sku, now) => store.reservations.filter((r) => r.sku === sku && r.expiresAt > now);
export const heldQty = (store, sku, now) => liveHolds(store, sku, now).reduce((s, r) => s + r.qty, 0);
export const available = (store, sku, now) => (store.stock[sku] ?? 0) - heldQty(store, sku, now);

export function reserve(store, { sku, qty, user }, now) {
  if (qty > available(store, sku, now)) throw new HttpError(409, 'out_of_stock', 'not enough stock');
  const hold = { id: `r${store.nextId++}`, sku, qty, user, expiresAt: now + config.holdMs };
  store.reservations.push(hold);
  return { id: hold.id, sku, qty, expiresAt: hold.expiresAt };
}

export function release(store, reservationId, now) {
  store.reservations = store.reservations.filter((r) => r.id !== reservationId);
}
