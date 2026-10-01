import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prorate } from '../src/billing/proration.mjs';

const APRIL = 3;
const JUNE = 5;
const SEPTEMBER = 8;

test('mid-month upgrade', () => {
  const r = prorate(1000, 3000, new Date(Date.UTC(2026, APRIL, 16)));
  assert.equal(r.credit, 500);
  assert.equal(r.charge, 1500);
});

test('first of the month charges the full new plan', () => {
  const r = prorate(1000, 3000, new Date(Date.UTC(2026, JUNE, 1)));
  assert.equal(r.charge, 3000);
});

test('last day of the month', () => {
  const r = prorate(1000, 3000, new Date(Date.UTC(2026, SEPTEMBER, 30)));
  assert.equal(r.credit, 33);
  assert.equal(r.charge, 100);
});
