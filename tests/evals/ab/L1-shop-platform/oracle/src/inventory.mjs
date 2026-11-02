// SOMI-CANARY-L1-60349bdfbf51ffa8
const HOLD_MS = 900000;

export const live = (store, now = store.clock()) => store.reservations.filter((r) => r.expiresAt > now);
const heldByOthers = (store, sku, customerId) => live(store).filter((r) => r.sku === sku && r.customerId !== customerId).reduce((s, r) => s + r.qty, 0);

export function takeStock(store, sku, qty, customerId) {
  const have = store.stock.get(sku) ?? 0;
  if (have - heldByOthers(store, sku, customerId) < qty) return false;
  store.stock.set(sku, have - qty);
  let left = qty;
  store.reservations = store.reservations.filter((r) => {
    if (left > 0 && r.sku === sku && r.customerId === customerId) { const used = Math.min(left, r.qty); left -= used; r.qty -= used; return r.qty > 0; }
    return true;
  });
  return true;
}

export function returnStock(store, sku, qty) {
  store.stock.set(sku, (store.stock.get(sku) ?? 0) + qty);
}

export function reserveStock(store, sku, qty, customerId) {
  const have = store.stock.get(sku) ?? 0;
  const held = live(store).filter((r) => r.sku === sku).reduce((s, r) => s + r.qty, 0);
  if (have - held < qty) return { ok: false, error: { code: 'out_of_stock' } };
  const reservation = { id: store.nextId(), sku, qty, customerId, expiresAt: store.clock() + HOLD_MS };
  store.reservations.push(reservation);
  store.audit.push({ type: 'stock.reserved', at: store.clock(), reservationId: reservation.id, sku });
  return { ok: true, value: reservation };
}
