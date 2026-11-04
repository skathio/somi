import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addRadios, voidRadios, radiosTotal } from '../src/radios/service.mjs';
import { radiosReport } from '../src/radios/report.mjs';

test('radios: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addRadios(store, { units: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(radiosTotal(store), 30);
});

test('radios: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addRadios(store, { units: 3, rate: 10 });
  voidRadios(store, entry.id);
  assert.equal(radiosTotal(store), 0);
  assert.deepEqual(radiosReport(store), []);
});

test('radios: too many units is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addRadios(store, { units: 121, rate: 10 }), RangeError);
});
