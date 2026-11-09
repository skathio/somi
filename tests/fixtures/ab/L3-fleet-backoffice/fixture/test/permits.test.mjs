import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerPermits, voidPermits, permitsTotal } from '../src/permits/service.mjs';
import { permitsReport } from '../src/permits/report.mjs';

test('permits: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerPermits(store, { permits: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(permitsTotal(store), 30);
});

test('permits: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerPermits(store, { permits: 3, rate: 10 });
  voidPermits(store, entry.id);
  assert.equal(permitsTotal(store), 0);
  assert.deepEqual(permitsReport(store), []);
});

test('permits: too many permits is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerPermits(store, { permits: 51, rate: 10 }), RangeError);
});
