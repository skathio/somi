import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addProduct, formatPrice } from '../src/catalog.mjs';
import { addToCart, cartTotal } from '../src/cart.mjs';

test('a total', () => {
  const store = createStore();
  addProduct(store, { sku: 'a', name: 'A', price: 19.99, stock: 5 });
  const cart = addToCart(store, 'c', 'a', 3);
  assert.equal(Math.round(cartTotal(store, cart) * 100), 5997);
  assert.equal(formatPrice(19.99), '$19.99');
});
