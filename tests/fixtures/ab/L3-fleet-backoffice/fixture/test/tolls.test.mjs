import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordTolls, voidTolls, tollsTotal } from '../src/tolls/service.mjs';
import { tollsReport } from '../src/tolls/report.mjs';

test('tolls: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordTolls(store, { crossings: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(tollsTotal(store), 30);
});

test('tolls: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordTolls(store, { crossings: 3, rate: 10 });
  voidTolls(store, entry.id);
  assert.equal(tollsTotal(store), 0);
  assert.deepEqual(tollsReport(store), []);
});

test('tolls: too many crossings is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordTolls(store, { crossings: 61, rate: 10 }), RangeError);
});
