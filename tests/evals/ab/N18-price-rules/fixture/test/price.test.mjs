import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceCart } from '../src/price.mjs';

test('a plain cart', () => {
  const r = priceCart({ items: [{ qty: 2, unit: 1000 }] });
  assert.equal(r.subtotal, 2000);
  assert.equal(r.shipping, 499);
  assert.equal(r.total, 2000 + 499 + 160);
});
