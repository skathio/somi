import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logAudits, voidAudits, auditsTotal } from '../src/audits/service.mjs';
import { auditsReport } from '../src/audits/report.mjs';

test('audits: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logAudits(store, { sites: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(auditsTotal(store), 30);
});

test('audits: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logAudits(store, { sites: 3, rate: 10 });
  voidAudits(store, entry.id);
  assert.equal(auditsTotal(store), 0);
  assert.deepEqual(auditsReport(store), []);
});

test('audits: too many sites is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logAudits(store, { sites: 21, rate: 10 }), RangeError);
});
