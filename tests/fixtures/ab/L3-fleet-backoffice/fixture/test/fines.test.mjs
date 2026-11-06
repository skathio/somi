import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordFines, voidFines, finesTotal } from '../src/fines/service.mjs';
import { finesReport } from '../src/fines/report.mjs';

test('fines: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordFines(store, { points: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(finesTotal(store), 30);
});

test('fines: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordFines(store, { points: 3, rate: 10 });
  voidFines(store, entry.id);
  assert.equal(finesTotal(store), 0);
  assert.deepEqual(finesReport(store), []);
});

test('fines: too many points is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordFines(store, { points: 31, rate: 10 }), RangeError);
});
