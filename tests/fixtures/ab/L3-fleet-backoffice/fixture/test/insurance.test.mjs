import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordInsurance, voidInsurance, insuranceTotal } from '../src/insurance/service.mjs';
import { insuranceReport } from '../src/insurance/report.mjs';

test('insurance: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordInsurance(store, { vehicles: 3, rate: 10 });
  assert.equal(entry.amount, 150.5);
  assert.equal(insuranceTotal(store), 150.5);
});

test('insurance: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordInsurance(store, { vehicles: 3, rate: 10 });
  voidInsurance(store, entry.id);
  assert.equal(insuranceTotal(store), 0);
  assert.deepEqual(insuranceReport(store), []);
});

test('insurance: too many vehicles is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordInsurance(store, { vehicles: 301, rate: 10 }), RangeError);
});
