import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerSoftware, voidSoftware, softwareTotal } from '../src/software/service.mjs';
import { softwareReport } from '../src/software/report.mjs';

test('software: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerSoftware(store, { seats: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(softwareTotal(store), 30);
});

test('software: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerSoftware(store, { seats: 3, rate: 10 });
  voidSoftware(store, entry.id);
  assert.equal(softwareTotal(store), 0);
  assert.deepEqual(softwareReport(store), []);
});

test('software: too many seats is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerSoftware(store, { seats: 501, rate: 10 }), RangeError);
});
