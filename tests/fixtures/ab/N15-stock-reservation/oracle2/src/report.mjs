// SOMI-CANARY-N15-72cad59fab26fdbc
import { holdsOn } from './holds.mjs';

export function stockReport(store, now) {
  return Object.entries(store.stock).sort(([a], [b]) => (a < b ? -1 : 1)).map(([sku, onShelf]) => {
    const reserved = holdsOn(store, sku, now);
    return { sku, onShelf, available: onShelf - reserved, reserved };
  });
}
