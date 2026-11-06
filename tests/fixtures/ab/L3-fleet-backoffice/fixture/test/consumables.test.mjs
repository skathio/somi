import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerConsumables, voidConsumables, consumablesTotal } from '../src/consumables/service.mjs';
import { consumablesReport } from '../src/consumables/report.mjs';

test('consumables: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerConsumables(store, { boxes: 3, rate: 10 });
  assert.equal(entry.amount, 0);
  assert.equal(consumablesTotal(store), 0);
});

test('consumables: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerConsumables(store, { boxes: 3, rate: 10 });
  voidConsumables(store, entry.id);
  assert.equal(consumablesTotal(store), 0);
  assert.deepEqual(consumablesReport(store), []);
});

test('consumables: too many boxes is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerConsumables(store, { boxes: 151, rate: 10 }), RangeError);
});
