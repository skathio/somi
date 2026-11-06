import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeOrder } from '../src/payments.mjs';

test('a charge', async () => {
  const gateway = { charge: async () => ({ id: 'c1' }) };
  const store = { get: async () => undefined, set: async () => {} };
  assert.deepEqual(await chargeOrder({ id: 'o1', amount: 5 }, { gateway, store }), { chargeId: 'c1', amount: 5 });
});
