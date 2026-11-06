import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logCustoms, voidCustoms, customsTotal } from '../src/customs/service.mjs';
import { customsReport } from '../src/customs/report.mjs';

test('customs: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logCustoms(store, { declarations: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(customsTotal(store), 30);
});

test('customs: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logCustoms(store, { declarations: 3, rate: 10 });
  voidCustoms(store, entry.id);
  assert.equal(customsTotal(store), 0);
  assert.deepEqual(customsReport(store), []);
});

test('customs: too many declarations is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logCustoms(store, { declarations: 51, rate: 10 }), RangeError);
});
