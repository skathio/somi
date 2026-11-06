import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importOrders } from '../src/import.mjs';

test('one row', () => {
  assert.deepEqual(importOrders([{ ref: 'a', email: 'x@y', amount: '1.50' }]), { items: [{ ref: 'a', email: 'x@y', amount: 150 }], skipped: 0 });
});
