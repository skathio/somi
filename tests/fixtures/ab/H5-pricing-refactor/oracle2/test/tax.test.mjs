// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PricingError } from '../src/errors.mjs';
import { COUNTRIES } from '../src/tables.mjs';
import { requireRates, taxFor } from '../src/tax.mjs';

const round = (x) => Math.round(x * 100) / 100;
const line = (now, category = 'general') => ({ sku: 'a', qty: 1, unitPrice: now, category, lineTotal: now, now, disc: 0 });
const input = (country, lines, over = {}) => ({ lines, card: COUNTRIES[country], ship: 0, handling: 0, exempt: false, round, ...over });

test('added tax is worked out per category group', () => {
  assert.equal(taxFor(input('US', [line(10), line(10, 'food'), line(5)])).tax, 1.09);
});

test('included tax is taken out of each line', () => {
  const r = taxFor(input('DE', [line(119), line(107, 'book')]));
  assert.deepEqual(r.lines.map((l) => l.tax), [19, 7]);
  assert.equal(r.tax, 26);
});

test('exempt customers pay no added tax', () => {
  assert.equal(taxFor(input('CA', [line(100)], { exempt: true })).tax, 0);
});

test('unknown categories are refused', () => {
  assert.throws(() => requireRates([line(1, 'weapons')], COUNTRIES.US), PricingError);
});
