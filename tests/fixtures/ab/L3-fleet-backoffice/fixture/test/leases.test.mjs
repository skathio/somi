import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerLeases, voidLeases, leasesTotal } from '../src/leases/service.mjs';
import { leasesReport } from '../src/leases/report.mjs';

test('leases: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerLeases(store, { months: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(leasesTotal(store), 30);
});

test('leases: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerLeases(store, { months: 3, rate: 10 });
  voidLeases(store, entry.id);
  assert.equal(leasesTotal(store), 0);
  assert.deepEqual(leasesReport(store), []);
});

test('leases: too many months is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerLeases(store, { months: 73, rate: 10 }), RangeError);
});
