import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logRepairs, voidRepairs, repairsTotal } from '../src/repairs/service.mjs';
import { repairsReport } from '../src/repairs/report.mjs';

test('repairs: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logRepairs(store, { hours: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(repairsTotal(store), 30);
});

test('repairs: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logRepairs(store, { hours: 3, rate: 10 });
  voidRepairs(store, entry.id);
  assert.equal(repairsTotal(store), 0);
  assert.deepEqual(repairsReport(store), []);
});

test('repairs: too many hours is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logRepairs(store, { hours: 161, rate: 10 }), RangeError);
});
