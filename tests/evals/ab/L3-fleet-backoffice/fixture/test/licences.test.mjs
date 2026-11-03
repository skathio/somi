import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logLicences, voidLicences, licencesTotal } from '../src/licences/service.mjs';
import { licencesReport } from '../src/licences/report.mjs';

test('licences: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = logLicences(store, { drivers: 3, rate: 10 });
  assert.equal(entry.amount, 58.25);
  assert.equal(licencesTotal(store), 58.25);
});

test('licences: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = logLicences(store, { drivers: 3, rate: 10 });
  voidLicences(store, entry.id);
  assert.equal(licencesTotal(store), 0);
  assert.deepEqual(licencesReport(store), []);
});

test('licences: too many drivers is refused', () => {
  const store = createStore(1000);
  assert.throws(() => logLicences(store, { drivers: 301, rate: 10 }), RangeError);
});
