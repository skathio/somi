import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addFuel, voidFuel, fuelTotal } from '../src/fuel/service.mjs';
import { fuelReport } from '../src/fuel/report.mjs';

test('fuel: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addFuel(store, { litres: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(fuelTotal(store), 30);
});

test('fuel: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addFuel(store, { litres: 3, rate: 10 });
  voidFuel(store, entry.id);
  assert.equal(fuelTotal(store), 0);
  assert.deepEqual(fuelReport(store), []);
});

test('fuel: too many litres is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addFuel(store, { litres: 501, rate: 10 }), RangeError);
});
