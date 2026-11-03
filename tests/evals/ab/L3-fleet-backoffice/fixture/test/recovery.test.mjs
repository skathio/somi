import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addRecovery, voidRecovery, recoveryTotal } from '../src/recovery/service.mjs';
import { recoveryReport } from '../src/recovery/report.mjs';

test('recovery: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addRecovery(store, { callouts: 3, rate: 10 });
  assert.equal(entry.amount, 40);
  assert.equal(recoveryTotal(store), 40);
});

test('recovery: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addRecovery(store, { callouts: 3, rate: 10 });
  voidRecovery(store, entry.id);
  assert.equal(recoveryTotal(store), 0);
  assert.deepEqual(recoveryReport(store), []);
});

test('recovery: too many callouts is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addRecovery(store, { callouts: 31, rate: 10 }), RangeError);
});
