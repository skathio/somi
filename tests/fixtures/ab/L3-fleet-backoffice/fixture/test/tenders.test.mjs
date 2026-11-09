import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addTenders, voidTenders, tendersTotal } from '../src/tenders/service.mjs';
import { tendersReport } from '../src/tenders/report.mjs';

test('tenders: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = addTenders(store, { bids: 3, rate: 10 });
  assert.equal(entry.amount, 20);
  assert.equal(tendersTotal(store), 20);
});

test('tenders: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = addTenders(store, { bids: 3, rate: 10 });
  voidTenders(store, entry.id);
  assert.equal(tendersTotal(store), 0);
  assert.deepEqual(tendersReport(store), []);
});

test('tenders: too many bids is refused', () => {
  const store = createStore(1000);
  assert.throws(() => addTenders(store, { bids: 26, rate: 10 }), RangeError);
});
