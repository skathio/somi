// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalsFor, fixedTo, roundTo } from '../src/rounding.mjs';

test('yen have no decimals, the other currencies two', () => {
  assert.equal(decimalsFor('JPY'), 0);
  assert.equal(decimalsFor('USD'), 2);
});

test('roundTo rounds halves up, also below zero', () => {
  assert.equal(roundTo(2.345, 2), 2.35);
  assert.equal(roundTo(-2.5, 0), -2);
  assert.equal(roundTo(1234.5, 0), 1235);
});

test('the two flavours differ on 1.115', () => {
  assert.equal(roundTo(1.115, 2), 1.12);
  assert.equal(fixedTo(1.115, 2), 1.11);
});
