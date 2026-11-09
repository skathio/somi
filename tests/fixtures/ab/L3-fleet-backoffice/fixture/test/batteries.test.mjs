import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addBatteries, voidBatteries, batteriesTotal } from '../src/batteries/service.mjs';
import { batteriesReport } from '../src/batteries/report.mjs';

test('batteries: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addBatteries(store, { packs: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(batteriesTotal(store), 30);
});

test('batteries: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addBatteries(store, { packs: 3, rate: 10 });
  voidBatteries(store, entry.id);
  assert.equal(batteriesTotal(store), 0);
  assert.deepEqual(batteriesReport(store), []);
});

test('batteries: too many packs is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addBatteries(store, { packs: 71, rate: 10 }), RangeError);
});
