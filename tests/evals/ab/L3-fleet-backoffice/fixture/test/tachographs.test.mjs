import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerTachographs, voidTachographs, tachographsTotal } from '../src/tachographs/service.mjs';
import { tachographsReport } from '../src/tachographs/report.mjs';

test('tachographs: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerTachographs(store, { units: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(tachographsTotal(store), 30);
});

test('tachographs: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerTachographs(store, { units: 3, rate: 10 });
  voidTachographs(store, entry.id);
  assert.equal(tachographsTotal(store), 0);
  assert.deepEqual(tachographsReport(store), []);
});

test('tachographs: too many units is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerTachographs(store, { units: 181, rate: 10 }), RangeError);
});
