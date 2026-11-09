// SOMI-CANARY-L1-60349bdfbf51ffa8
export function addProduct(store, { sku, name, price, stock = 0 }) {
  store.products.set(sku, { sku, name, price });
  store.stock.set(sku, stock);
  return store.products.get(sku);
}

export const getProduct = (store, sku) => store.products.get(sku) ?? null;

export const formatPrice = (cents) => `$${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
