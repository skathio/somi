import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PricingError, couponCodes, quote } from '../src/pricing.mjs';

const cart = (over = {}) => ({
  currency: 'USD',
  customer: { country: 'US', tier: 'standard' },
  items: [{ sku: 'mug', qty: 2, unitPrice: 20, category: 'general', weight: 1 }],
  shipping: { method: 'standard' },
  ...over,
});

test('tax is added on top in the US', () => {
  const q = quote(cart());
  assert.equal(q.subtotal, 40);
  assert.equal(q.tax, 2.9);
  assert.equal(q.taxIncluded, false);
  assert.equal(q.total, q.subtotal + q.shipping + q.tax);
});

test('in Germany the price already includes the tax', () => {
  const q = quote(cart({ currency: 'EUR', customer: { country: 'DE', tier: 'standard' } }));
  assert.equal(q.taxIncluded, true);
  assert.equal(q.tax, 7.62); // the VAT inside the goods (6.39) and inside the shipping charge
  assert.equal(q.total, q.subtotal + q.shipping);
});

test('SAVE10 takes ten percent off', () => {
  const q = quote(cart({ coupons: ['save10'] }));
  assert.equal(q.discount, 4);
  assert.deepEqual(q.appliedCoupons, ['SAVE10']);
});

test('an unknown coupon is reported, not applied', () => {
  const q = quote(cart({ coupons: ['NOPE'] }));
  assert.deepEqual(q.rejectedCoupons, [{ code: 'NOPE', reason: 'unknown' }]);
  assert.equal(q.discount, 0);
});

test('standard shipping is free from 75 in the US', () => {
  assert.equal(quote(cart({ items: [{ sku: 'a', qty: 1, unitPrice: 75, category: 'general' }] })).shipping, 0);
  assert.ok(quote(cart({ items: [{ sku: 'a', qty: 1, unitPrice: 74, category: 'general' }] })).shipping > 0);
});

test('yen are whole numbers', () => {
  const q = quote(cart({ currency: 'JPY', customer: { country: 'JP', tier: 'standard' }, items: [{ sku: 'a', qty: 3, unitPrice: 333, category: 'general' }] }));
  assert.equal(q.subtotal, 999);
  assert.ok(Number.isInteger(q.total));
});

test('an empty cart is refused', () => {
  assert.throws(() => quote(cart({ items: [] })), (e) => e instanceof PricingError && e.code === 'empty_cart');
});

test('the coupon list is sorted', () => {
  assert.deepEqual(couponCodes(), [...couponCodes()].sort());
});
