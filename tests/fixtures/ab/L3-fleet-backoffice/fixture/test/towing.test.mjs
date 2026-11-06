import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addTowing, voidTowing, towingTotal } from '../src/towing/service.mjs';
import { towingReport } from '../src/towing/report.mjs';

test('towing: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addTowing(store, { km: 3, rate: 10 });
  assert.equal(entry.amount, 0);
  assert.equal(towingTotal(store), 0);
});

test('towing: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addTowing(store, { km: 3, rate: 10 });
  voidTowing(store, entry.id);
  assert.equal(towingTotal(store), 0);
  assert.deepEqual(towingReport(store), []);
});

test('towing: too many km is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addTowing(store, { km: 801, rate: 10 }), RangeError);
});
