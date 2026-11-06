import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerInspections, voidInspections, inspectionsTotal } from '../src/inspections/service.mjs';
import { inspectionsReport } from '../src/inspections/report.mjs';

test('inspections: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerInspections(store, { vehicles: 3, rate: 10 });
  assert.equal(entry.amount, 96.5);
  assert.equal(inspectionsTotal(store), 96.5);
});

test('inspections: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerInspections(store, { vehicles: 3, rate: 10 });
  voidInspections(store, entry.id);
  assert.equal(inspectionsTotal(store), 0);
  assert.deepEqual(inspectionsReport(store), []);
});

test('inspections: too many vehicles is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerInspections(store, { vehicles: 251, rate: 10 }), RangeError);
});
