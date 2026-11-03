import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addRentals, voidRentals, rentalsTotal } from '../src/rentals/service.mjs';
import { rentalsReport } from '../src/rentals/report.mjs';

test('rentals: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addRentals(store, { days: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(rentalsTotal(store), 30);
});

test('rentals: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addRentals(store, { days: 3, rate: 10 });
  voidRentals(store, entry.id);
  assert.equal(rentalsTotal(store), 0);
  assert.deepEqual(rentalsReport(store), []);
});

test('rentals: too many days is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addRentals(store, { days: 91, rate: 10 }), RangeError);
});
