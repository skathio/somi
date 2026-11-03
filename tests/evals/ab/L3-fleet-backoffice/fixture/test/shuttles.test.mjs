import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordShuttles, voidShuttles, shuttlesTotal } from '../src/shuttles/service.mjs';
import { shuttlesReport } from '../src/shuttles/report.mjs';

test('shuttles: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordShuttles(store, { runs: 3, rate: 10 });
  assert.equal(entry.amount, 0);
  assert.equal(shuttlesTotal(store), 0);
});

test('shuttles: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordShuttles(store, { runs: 3, rate: 10 });
  voidShuttles(store, entry.id);
  assert.equal(shuttlesTotal(store), 0);
  assert.deepEqual(shuttlesReport(store), []);
});

test('shuttles: too many runs is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordShuttles(store, { runs: 301, rate: 10 }), RangeError);
});
