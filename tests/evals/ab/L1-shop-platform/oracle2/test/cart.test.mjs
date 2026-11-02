// SOMI-CANARY-L1-60349bdfbf51ffa8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addProduct } from '../src/catalog.mjs';
import { addToCart, cartTotal } from '../src/cart.mjs';

test('cents', () => {
  const store = createStore();
  addProduct(store, { sku: 'a', name: 'A', price: 1999, stock: 5 });
  assert.equal(cartTotal(store, addToCart(store, 'c', 'a', 3)), 5997);
});
