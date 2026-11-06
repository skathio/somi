import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logTraining, voidTraining, trainingTotal } from '../src/training/service.mjs';
import { trainingReport } from '../src/training/report.mjs';

test('training: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logTraining(store, { seats: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(trainingTotal(store), 30);
});

test('training: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logTraining(store, { seats: 3, rate: 10 });
  voidTraining(store, entry.id);
  assert.equal(trainingTotal(store), 0);
  assert.deepEqual(trainingReport(store), []);
});

test('training: too many seats is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logTraining(store, { seats: 91, rate: 10 }), RangeError);
});
