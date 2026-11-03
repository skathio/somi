import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordScales, voidScales, scalesTotal } from '../src/scales/service.mjs';
import { scalesReport } from '../src/scales/report.mjs';

test('scales: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordScales(store, { weighings: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(scalesTotal(store), 30);
});

test('scales: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordScales(store, { weighings: 3, rate: 10 });
  voidScales(store, entry.id);
  assert.equal(scalesTotal(store), 0);
  assert.deepEqual(scalesReport(store), []);
});

test('scales: too many weighings is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordScales(store, { weighings: 241, rate: 10 }), RangeError);
});
