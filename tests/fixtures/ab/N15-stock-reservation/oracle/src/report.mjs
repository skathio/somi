// SOMI-CANARY-N15-72cad59fab26fdbc
import { available, heldQty } from './reservations.mjs';

export function stockReport(store, now) {
  return Object.keys(store.stock).sort().map((sku) => ({ sku, onShelf: store.stock[sku], available: available(store, sku, now), reserved: heldQty(store, sku, now) }));
}
