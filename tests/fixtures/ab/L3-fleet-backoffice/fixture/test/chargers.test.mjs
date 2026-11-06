import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logChargers, voidChargers, chargersTotal } from '../src/chargers/service.mjs';
import { chargersReport } from '../src/chargers/report.mjs';

test('chargers: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logChargers(store, { sessions: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(chargersTotal(store), 30);
});

test('chargers: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logChargers(store, { sessions: 3, rate: 10 });
  voidChargers(store, entry.id);
  assert.equal(chargersTotal(store), 0);
  assert.deepEqual(chargersReport(store), []);
});

test('chargers: too many sessions is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logChargers(store, { sessions: 601, rate: 10 }), RangeError);
});
