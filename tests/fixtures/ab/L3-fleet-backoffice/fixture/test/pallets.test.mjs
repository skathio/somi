import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addPallets, voidPallets, palletsTotal } from '../src/pallets/service.mjs';
import { palletsReport } from '../src/pallets/report.mjs';

test('pallets: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addPallets(store, { pallets: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(palletsTotal(store), 30);
});

test('pallets: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addPallets(store, { pallets: 3, rate: 10 });
  voidPallets(store, entry.id);
  assert.equal(palletsTotal(store), 0);
  assert.deepEqual(palletsReport(store), []);
});

test('pallets: too many pallets is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addPallets(store, { pallets: 801, rate: 10 }), RangeError);
});
