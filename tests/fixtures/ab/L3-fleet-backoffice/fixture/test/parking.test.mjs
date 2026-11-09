import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addParking, voidParking, parkingTotal } from '../src/parking/service.mjs';
import { parkingReport } from '../src/parking/report.mjs';

test('parking: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addParking(store, { hours: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(parkingTotal(store), 30);
});

test('parking: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addParking(store, { hours: 3, rate: 10 });
  voidParking(store, entry.id);
  assert.equal(parkingTotal(store), 0);
  assert.deepEqual(parkingReport(store), []);
});

test('parking: too many hours is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addParking(store, { hours: 73, rate: 10 }), RangeError);
});
