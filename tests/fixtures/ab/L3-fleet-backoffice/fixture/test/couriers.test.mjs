import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordCouriers, voidCouriers, couriersTotal } from '../src/couriers/service.mjs';
import { couriersReport } from '../src/couriers/report.mjs';

test('couriers: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordCouriers(store, { parcels: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(couriersTotal(store), 30);
});

test('couriers: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordCouriers(store, { parcels: 3, rate: 10 });
  voidCouriers(store, entry.id);
  assert.equal(couriersTotal(store), 0);
  assert.deepEqual(couriersReport(store), []);
});

test('couriers: too many parcels is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordCouriers(store, { parcels: 901, rate: 10 }), RangeError);
});
