import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logTrips, voidTrips, tripsTotal } from '../src/trips/service.mjs';
import { tripsReport } from '../src/trips/report.mjs';

test('trips: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logTrips(store, { km: 3, rate: 10 });
  assert.equal(entry.amount, 0);
  assert.equal(tripsTotal(store), 0);
});

test('trips: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logTrips(store, { km: 3, rate: 10 });
  voidTrips(store, entry.id);
  assert.equal(tripsTotal(store), 0);
  assert.deepEqual(tripsReport(store), []);
});

test('trips: too many km is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logTrips(store, { km: 2001, rate: 10 }), RangeError);
});
