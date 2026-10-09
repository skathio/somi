// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoupons, chooseCoupons, memberDiscount, quantityDiscount } from '../src/discounts.mjs';

const round = (x) => Math.round(x * 100) / 100;
const line = (total, over = {}) => ({ sku: 'a', qty: 1, category: 'general', lineTotal: total, now: total, disc: 0, ...over });
const ctx = (over = {}) => ({ coupons: [], date: undefined, tier: 'standard', subtotal: 100, currency: 'USD', round, ...over });

test('quantity bands apply to physical goods only', () => {
  const out = quantityDiscount([line(100, { qty: 25 }), line(100, { qty: 10 }), line(100, { qty: 30, category: 'digital' })], round);
  assert.deepEqual(out.map((l) => l.now), [94, 97, 100]);
});

test('members get a percentage on top, without touching the input lines', () => {
  const input = [line(100)];
  const out = memberDiscount(input, 'silver', round);
  assert.equal(out[0].now, 98);
  assert.equal(input[0].now, 100);
});

test('three distinct known codes count, the rest are rejected', () => {
  const r = chooseCoupons(['save10', 'SAVE10', 'x', 'TENOFF', 'FIVEOFF', 'WELCOME']);
  assert.deepEqual([...r.chosen], ['SAVE10', 'TENOFF', 'FIVEOFF']);
  assert.deepEqual(r.rejected.map((x) => x.reason), ['duplicate', 'unknown', 'limit']);
});

test('coupons run in the fixed order and SAVE20 shuts out SAVE10', () => {
  const r = applyCoupons([line(200)], ctx({ coupons: ['FIVEOFF', 'SAVE10', 'SAVE20'], subtotal: 200 }));
  assert.deepEqual(r.applied, ['SAVE20', 'FIVEOFF']);
  assert.deepEqual(r.rejected, [{ code: 'SAVE10', reason: 'excluded' }]);
});

test('an expired coupon is refused', () => {
  const r = applyCoupons([line(100)], ctx({ coupons: ['WELCOME'], date: '2025-07-01' }));
  assert.deepEqual(r.rejected, [{ code: 'WELCOME', reason: 'expired' }]);
});
