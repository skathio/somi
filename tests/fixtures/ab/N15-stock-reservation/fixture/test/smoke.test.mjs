import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from '../src/checkout.mjs';

test('takes stock', () => {
  const store = { stock: { a: 2 }, reservations: [], nextId: 1 };
  checkout(store, { sku: 'a', qty: 1 }, { now: 0 });
  assert.equal(store.stock.a, 1);
});
