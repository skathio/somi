export function stockReport(store, now) {
  return Object.keys(store.stock).sort().map((sku) => ({ sku, onShelf: store.stock[sku], available: store.stock[sku], reserved: 0 }));
}
