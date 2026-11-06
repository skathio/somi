// SOMI-CANARY-N15-72cad59fab26fdbc
export function holdsOn(store, sku, now) {
  let total = 0;
  for (const h of store.reservations) if (h.sku === sku && now < h.expiresAt) total += h.qty;
  return total;
}
