// SOMI-CANARY-N15-72cad59fab26fdbc
import { config } from './config.mjs';
import { HttpError } from './errors.mjs';
import { holdsOn } from './holds.mjs';

export function reserve(store, { sku, qty, user }, now) {
  if ((store.stock[sku] ?? 0) - holdsOn(store, sku, now) < qty) throw new HttpError(409, 'out_of_stock', 'none left');
  const id = 'hold-' + store.nextId;
  store.nextId += 1;
  const expiresAt = now + config.holdMs;
  store.reservations.push({ id, sku, qty, user, expiresAt });
  return { id, sku, qty, expiresAt };
}

export function release(store, reservationId) {
  const at = store.reservations.findIndex((r) => r.id === reservationId);
  if (at !== -1) store.reservations.splice(at, 1);
}
