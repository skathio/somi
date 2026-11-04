import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordMedicals, voidMedicals, medicalsTotal } from '../src/medicals/service.mjs';
import { medicalsReport } from '../src/medicals/report.mjs';

test('medicals: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordMedicals(store, { drivers: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(medicalsTotal(store), 30);
});

test('medicals: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordMedicals(store, { drivers: 3, rate: 10 });
  voidMedicals(store, entry.id);
  assert.equal(medicalsTotal(store), 0);
  assert.deepEqual(medicalsReport(store), []);
});

test('medicals: too many drivers is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordMedicals(store, { drivers: 121, rate: 10 }), RangeError);
});
