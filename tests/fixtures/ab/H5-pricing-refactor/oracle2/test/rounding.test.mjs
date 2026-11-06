// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digitsOf, roundFor, scaled, viaString } from '../src/rounding.mjs';

test('digits per currency', () => {
  assert.deepEqual(['JPY', 'USD', 'EUR'].map(digitsOf), [0, 2, 2]);
});

test('scaled rounds halves up and viaString follows the decimal string', () => {
  assert.equal(scaled(1.115, 2), 1.12);
  assert.equal(viaString(1.115, 2), 1.11);
  assert.equal(scaled(-0.5, 0), -0);
});

test('roundFor binds the currency', () => {
  assert.equal(roundFor('JPY')(10.5), 11);
  assert.equal(roundFor('USD')(10.555), 10.56);
});
