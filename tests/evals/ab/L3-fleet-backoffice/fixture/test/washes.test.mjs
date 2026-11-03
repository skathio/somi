import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logWashes, voidWashes, washesTotal } from '../src/washes/service.mjs';
import { washesReport } from '../src/washes/report.mjs';

test('washes: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logWashes(store, { washes: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(washesTotal(store), 30);
});

test('washes: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logWashes(store, { washes: 3, rate: 10 });
  voidWashes(store, entry.id);
  assert.equal(washesTotal(store), 0);
  assert.deepEqual(washesReport(store), []);
});

test('washes: too many washes is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logWashes(store, { washes: 201, rate: 10 }), RangeError);
});
