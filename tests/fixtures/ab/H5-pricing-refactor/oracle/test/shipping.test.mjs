// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY } from '../src/countries.mjs';
import { PricingError } from '../src/errors.mjs';
import { handlingFor, methodOf, ratesFor, shippingFor } from '../src/shipping.mjs';

const lines = [{ category: 'general', weight: 1, qty: 2 }];
const args = (over = {}) => ({ lines, country: COUNTRY.US, method: 'standard', merch: 40, freeShip: false, currency: 'USD', decimals: 2, ...over });

test('a standard parcel costs the base plus the weight', () => {
  assert.equal(shippingFor(args()), 7.39);
});

test('it is free above the threshold, half price for express, nothing for pickup or downloads', () => {
  assert.equal(shippingFor(args({ merch: 75 })), 0);
  assert.equal(shippingFor(args({ merch: 75, method: 'express' })), 9.99);
  assert.equal(shippingFor(args({ method: 'pickup' })), 0);
  assert.equal(shippingFor(args({ lines: [{ category: 'digital', weight: 1, qty: 1 }] })), 0);
});

test('small orders pay the handling fee', () => {
  assert.equal(handlingFor(args({ merch: 14.99 })), 1.5);
  assert.equal(handlingFor(args({ merch: 15 })), 0);
});

test('unknown countries and methods are refused with a PricingError', () => {
  assert.throws(() => ratesFor('ZZ'), (e) => e instanceof PricingError && e.code === 'unknown_country');
  assert.throws(() => methodOf({ shipping: { method: 'drone' } }), (e) => e instanceof PricingError && e.code === 'bad_shipping');
  assert.equal(methodOf({}), 'standard');
});
