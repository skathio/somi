import { fail, ok } from './result.mjs';

const view = (p) => ({ ...p });

export function addProduct(store, { sku, name, priceCents, stock }) {
  if (typeof sku !== 'string' || sku === '' || store.products.has(sku)) return fail('invalid');
  if (typeof name !== 'string' || name === '') return fail('invalid');
  if (!Number.isInteger(priceCents) || priceCents < 0) return fail('invalid');
  if (!Number.isInteger(stock)) return fail('invalid');
  const product = { sku, name, priceCents, stock };
  store.products.set(sku, product);
  return ok(view(product));
}

export function getProduct(store, sku) {
  const p = store.products.get(sku);
  return p ? ok(view(p)) : fail('not_found');
}

export function listProducts(store) {
  return [...store.products.values()].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)).map(view);
}
