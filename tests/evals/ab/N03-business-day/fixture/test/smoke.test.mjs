import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyReport } from '../src/reports.mjs';

test('a midday order lands on its day', () => {
  const r = dailyReport([{ at: '2025-03-14T16:00:00Z', amount: 5 }], 2025, 3);
  assert.equal(r['2025-03-14'], 5);
  assert.equal(Object.keys(r).length, 31);
});
