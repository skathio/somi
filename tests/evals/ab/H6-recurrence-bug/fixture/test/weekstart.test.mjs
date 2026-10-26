import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, occursOn } from '../src/index.mjs';

test('a week can start on another day', () => {
  const rule = { freq: 'weekly', interval: 2, byWeekday: ['sun', 'wed'], weekStart: 'sun', start: '2025-03-02' };
  assert.deepEqual(occurrences(rule, { to: '2025-04-01' }), ['2025-03-02', '2025-03-05', '2025-03-16', '2025-03-19', '2025-03-30']);
  assert.equal(occursOn(rule, '2025-03-05'), true);
  assert.equal(occursOn(rule, '2025-03-12'), false);
});
