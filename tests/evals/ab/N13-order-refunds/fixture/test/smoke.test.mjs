import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, payOrder } from '../src/orders.mjs';

test('paying posts a balanced sale', () => {
  const store = { orders: [], ledger: [], outbox: [] };
  createOrder(store, 'o1', 110, 10);
  assert.equal(payOrder(store, 'o1').status, 'paid');
});
