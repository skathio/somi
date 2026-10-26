// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY } from '../src/countries.mjs';
import { PricingError } from '../src/errors.mjs';
import { checkCategories, taxFor } from '../src/tax.mjs';

const line = (now, category = 'general') => ({ sku: 'a', qty: 1, unitPrice: now, category, lineTotal: now, now, disc: 0 });
const args = (country, lines, over = {}) => ({ lines, country: COUNTRY[country], ship: 0, handling: 0, exempt: false, decimals: 2, ...over });

test('tax is added on top where prices exclude it, per category group', () => {
  const r = taxFor(args('US', [line(10), line(10, 'food'), line(5)]));
  assert.equal(r.tax, 1.09);
});

test('tax is taken out of each line where prices include it', () => {
  const r = taxFor(args('DE', [line(119), line(107, 'book')]));
  assert.deepEqual(r.lines.map((l) => l.tax), [19, 7]);
  assert.equal(r.tax, 26);
});

test('an exempt customer pays no added tax', () => {
  assert.equal(taxFor(args('US', [line(100)], { exempt: true })).tax, 0);
});

test('a category without a rate is refused', () => {
  assert.throws(() => checkCategories([line(1, 'weapons')], COUNTRY.US), (e) => e instanceof PricingError && e.code === 'bad_item');
});
