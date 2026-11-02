// SOMI-CANARY-L1-60349bdfbf51ffa8
const FIFTEEN_MINUTES = 15 * 60 * 1000;

const active = (store) => store.reservations.filter((r) => store.clock() < r.expiresAt);

export function takeStock(store, sku, qty, customerId) {
  const onShelf = store.stock.get(sku) ?? 0;
  const others = active(store).reduce((s, r) => (r.sku === sku && r.customerId !== customerId ? s + r.qty : s), 0);
  if (onShelf - others < qty) return false;
  store.stock.set(sku, onShelf - qty);
  let need = qty;
  for (const r of active(store)) {
    if (r.sku !== sku || r.customerId !== customerId || need === 0) continue;
    const use = Math.min(need, r.qty);
    r.qty -= use;
    need -= use;
  }
  store.reservations = store.reservations.filter((r) => r.qty > 0);
  return true;
}

export function returnStock(store, sku, qty) {
  store.stock.set(sku, (store.stock.get(sku) ?? 0) + qty);
}

export function reserveStock(store, sku, qty, customerId) {
  const free = (store.stock.get(sku) ?? 0) - active(store).reduce((s, r) => (r.sku === sku ? s + r.qty : s), 0);
  if (qty > free) return { ok: false, error: { code: 'out_of_stock' } };
  const value = { id: store.nextId(), sku, qty, customerId, expiresAt: store.clock() + FIFTEEN_MINUTES };
  store.reservations.push(value);
  store.audit.push({ type: 'reservation', at: store.clock(), id: value.id });
  return { ok: true, value };
}
