import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listOrders } from '../src/orders.mjs';

test('a list', () => {
  assert.equal(listOrders({ orders: [{ id: 'a', createdAt: 1 }] }).total, 1);
});
