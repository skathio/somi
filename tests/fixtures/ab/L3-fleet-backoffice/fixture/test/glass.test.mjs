import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordGlass, voidGlass, glassTotal } from '../src/glass/service.mjs';
import { glassReport } from '../src/glass/report.mjs';

test('glass: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = recordGlass(store, { panes: 3, rate: 10 });
  assert.equal(entry.amount, 57.75);
  assert.equal(glassTotal(store), 57.75);
});

test('glass: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = recordGlass(store, { panes: 3, rate: 10 });
  voidGlass(store, entry.id);
  assert.equal(glassTotal(store), 0);
  assert.deepEqual(glassReport(store), []);
});

test('glass: too many panes is refused', () => {
  const store = createStore(1000);
  assert.throws(() => recordGlass(store, { panes: 25, rate: 10 }), RangeError);
});
