import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordStorage, voidStorage, storageTotal } from '../src/storage/service.mjs';
import { storageReport } from '../src/storage/report.mjs';

test('storage: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordStorage(store, { pallets: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(storageTotal(store), 30);
});

test('storage: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordStorage(store, { pallets: 3, rate: 10 });
  voidStorage(store, entry.id);
  assert.equal(storageTotal(store), 0);
  assert.deepEqual(storageReport(store), []);
});

test('storage: too many pallets is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordStorage(store, { pallets: 401, rate: 10 }), RangeError);
});
