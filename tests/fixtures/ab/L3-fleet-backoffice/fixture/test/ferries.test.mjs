import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logFerries, voidFerries, ferriesTotal } from '../src/ferries/service.mjs';
import { ferriesReport } from '../src/ferries/report.mjs';

test('ferries: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logFerries(store, { sailings: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(ferriesTotal(store), 30);
});

test('ferries: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logFerries(store, { sailings: 3, rate: 10 });
  voidFerries(store, entry.id);
  assert.equal(ferriesTotal(store), 0);
  assert.deepEqual(ferriesReport(store), []);
});

test('ferries: too many sailings is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logFerries(store, { sailings: 151, rate: 10 }), RangeError);
});
