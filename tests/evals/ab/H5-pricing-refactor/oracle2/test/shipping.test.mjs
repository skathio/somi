// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PricingError } from '../src/errors.mjs';
import { handlingFee, methodFor, rateCard, shippingCharge } from '../src/shipping.mjs';

const goods = [{ category: 'general', weight: 1, qty: 2 }];
const base = (over = {}) => ({ lines: goods, card: rateCard('US'), method: 'standard', merch: 40, freeShip: false, currency: 'USD', digits: 2, ...over });

test('a standard parcel costs the base plus the weight', () => {
  assert.equal(shippingCharge(base()), 7.39);
});

test('free above the threshold, half for express, nothing for pickup or downloads', () => {
  assert.equal(shippingCharge(base({ merch: 80 })), 0);
  assert.equal(shippingCharge(base({ merch: 80, method: 'express' })), 9.99);
  assert.equal(shippingCharge(base({ method: 'pickup' })), 0);
  assert.equal(shippingCharge(base({ lines: [{ category: 'digital', weight: 1, qty: 1 }] })), 0);
});

test('handling applies to small physical orders', () => {
  assert.equal(handlingFee(base({ merch: 10 })), 1.5);
  assert.equal(handlingFee(base({ merch: 20 })), 0);
});

test('bad country and bad method are PricingErrors', () => {
  assert.throws(() => rateCard('XX'), PricingError);
  assert.throws(() => methodFor({ shipping: { method: 'boat' } }), PricingError);
});
