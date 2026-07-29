import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prorate } from '../src/billing/proration.mjs';

test('mid-month upgrade, April (30 days)', () => {
  const r = prorate(1000, 3000, new Date(Date.UTC(2026, 3, 16)));
  assert.equal(r.credit, 500);
  assert.equal(r.charge, 1500);
});

test('first of the month charges the full new plan, June (30 days)', () => {
  const r = prorate(1000, 3000, new Date(Date.UTC(2026, 5, 1)));
  assert.equal(r.charge, 3000);
});

test('last day of the month, September (30 days)', () => {
  const r = prorate(1000, 3000, new Date(Date.UTC(2026, 8, 30)));
  assert.equal(r.credit, 33);
  assert.equal(r.charge, 100);
});
