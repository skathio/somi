// SOMI-CANARY-L1-60349bdfbf51ffa8
export function addProduct(store, product) {
  const { sku, name, price, stock = 0 } = product;
  store.products.set(sku, { sku, name, price });
  store.stock.set(sku, stock);
  return store.products.get(sku);
}

export const getProduct = (store, sku) => store.products.get(sku) ?? null;

export function formatPrice(cents) {
  const text = String(cents).padStart(3, '0');
  return '$' + text.slice(0, -2) + '.' + text.slice(-2);
}
