import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addProduct, listProducts } from '../src/catalog.mjs';

test('products list in sku order', () => {
  const store = createStore({ clock: () => '2031-07-01T00:00:00Z' });
  addProduct(store, { sku: 'B-2', name: 'Bolt', priceCents: 25, stock: 10 });
  addProduct(store, { sku: 'A-1', name: 'Anchor', priceCents: 1999, stock: 0 });
  assert.deepEqual(listProducts(store).map((p) => p.sku), ['A-1', 'B-2']);
});
