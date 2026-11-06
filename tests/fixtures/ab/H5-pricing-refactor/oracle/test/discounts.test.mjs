// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscounts, couponCodes } from '../src/discounts.mjs';
import { roundTo } from '../src/rounding.mjs';

const round = (x) => roundTo(x, 2);
const line = (total, over = {}) => ({ sku: 'a', qty: 1, category: 'general', lineTotal: total, now: total, disc: 0, ...over });
const run = (lines, over = {}) => applyDiscounts(lines, { subtotal: round(lines.reduce((a, l) => a + l.lineTotal, 0)), tier: 'standard', coupons: [], currency: 'USD', round, ...over });

test('coupons are applied in a fixed order, whatever order they were typed in', () => {
  const a = run([line(100)], { coupons: ['FIVEOFF', 'SAVE10'] });
  const b = run([line(100)], { coupons: ['SAVE10', 'FIVEOFF'] });
  assert.deepEqual(a.applied, ['SAVE10', 'FIVEOFF']);
  assert.deepEqual(b, a);
  assert.equal(a.merch, 85);
});

test('only three distinct known codes count; the rest are rejected with a reason', () => {
  const r = run([line(100)], { coupons: ['SAVE10', 'save10', 'NOPE', 'TENOFF', 'FIVEOFF', 'WELCOME'] });
  assert.deepEqual(r.rejected.map((x) => x.reason), ['duplicate', 'unknown', 'limit']);
});

test('the 20 percent coupon excludes the 10 percent one', () => {
  const r = run([line(200)], { coupons: ['SAVE10', 'SAVE20'] });
  assert.deepEqual(r.applied, ['SAVE20']);
  assert.deepEqual(r.rejected, [{ code: 'SAVE10', reason: 'excluded' }]);
});

test('a fixed coupon is spread over the lines and the last one takes the rest', () => {
  const lines = [line(10), line(10), line(10)];
  const r = run(lines, { coupons: ['FIVEOFF'], subtotal: 30 });
  assert.equal(r.discount, 5);
  assert.deepEqual(lines.map((l) => l.disc), [1.67, 1.67, 1.66]);
});

test('members and large quantities get their discounts before coupons', () => {
  const r = run([line(100, { qty: 10 })], { tier: 'gold' });
  assert.equal(r.merch, 92);
});

test('the coupon list is sorted', () => {
  assert.deepEqual(couponCodes(), [...couponCodes()].sort());
});
