export function takeStock(store, sku, qty) {
  const have = store.stock.get(sku) ?? 0;
  if (have < qty) return false;
  store.stock.set(sku, have - qty);
  return true;
}

export function returnStock(store, sku, qty) {
  store.stock.set(sku, (store.stock.get(sku) ?? 0) + qty);
}
