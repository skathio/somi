import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addOil, voidOil, oilTotal } from '../src/oil/service.mjs';
import { oilReport } from '../src/oil/report.mjs';

test('oil: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addOil(store, { litres: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(oilTotal(store), 30);
});

test('oil: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addOil(store, { litres: 3, rate: 10 });
  voidOil(store, entry.id);
  assert.equal(oilTotal(store), 0);
  assert.deepEqual(oilReport(store), []);
});

test('oil: too many litres is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addOil(store, { litres: 901, rate: 10 }), RangeError);
});
