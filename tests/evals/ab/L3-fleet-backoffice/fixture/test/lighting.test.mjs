import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerLighting, voidLighting, lightingTotal } from '../src/lighting/service.mjs';
import { lightingReport } from '../src/lighting/report.mjs';

test('lighting: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerLighting(store, { lamps: 3, rate: 10 });
  assert.equal(entry.amount, 33.75);
  assert.equal(lightingTotal(store), 33.75);
});

test('lighting: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerLighting(store, { lamps: 3, rate: 10 });
  voidLighting(store, entry.id);
  assert.equal(lightingTotal(store), 0);
  assert.deepEqual(lightingReport(store), []);
});

test('lighting: too many lamps is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerLighting(store, { lamps: 111, rate: 10 }), RangeError);
});
