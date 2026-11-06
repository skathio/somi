import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addCleaning, voidCleaning, cleaningTotal } from '../src/cleaning/service.mjs';
import { cleaningReport } from '../src/cleaning/report.mjs';

test('cleaning: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addCleaning(store, { cabins: 3, rate: 10 });
  assert.equal(entry.amount, 10);
  assert.equal(cleaningTotal(store), 10);
});

test('cleaning: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addCleaning(store, { cabins: 3, rate: 10 });
  voidCleaning(store, entry.id);
  assert.equal(cleaningTotal(store), 0);
  assert.deepEqual(cleaningReport(store), []);
});

test('cleaning: too many cabins is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addCleaning(store, { cabins: 81, rate: 10 }), RangeError);
});
