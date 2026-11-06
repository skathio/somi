import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerTires, voidTires, tiresTotal } from '../src/tires/service.mjs';
import { tiresReport } from '../src/tires/report.mjs';

test('tires: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerTires(store, { tires: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(tiresTotal(store), 30);
});

test('tires: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerTires(store, { tires: 3, rate: 10 });
  voidTires(store, entry.id);
  assert.equal(tiresTotal(store), 0);
  assert.deepEqual(tiresReport(store), []);
});

test('tires: too many tires is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerTires(store, { tires: 41, rate: 10 }), RangeError);
});
