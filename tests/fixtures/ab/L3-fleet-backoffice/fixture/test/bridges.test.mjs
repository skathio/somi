import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logBridges, voidBridges, bridgesTotal } from '../src/bridges/service.mjs';
import { bridgesReport } from '../src/bridges/report.mjs';

test('bridges: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logBridges(store, { crossings: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(bridgesTotal(store), 30);
});

test('bridges: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logBridges(store, { crossings: 3, rate: 10 });
  voidBridges(store, entry.id);
  assert.equal(bridgesTotal(store), 0);
  assert.deepEqual(bridgesReport(store), []);
});

test('bridges: too many crossings is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logBridges(store, { crossings: 401, rate: 10 }), RangeError);
});
