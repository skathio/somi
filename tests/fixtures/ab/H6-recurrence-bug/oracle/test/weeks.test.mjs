// SOMI-CANARY-H6-c3a91e5d7b204f68
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, occursOn } from '../src/index.mjs';

test('what was asked before does not change the days of a weekly rule', () => {
  const monday = { freq: 'weekly', interval: 2, byWeekday: ['sun', 'wed'], start: '2025-03-02' };
  const sunday = { ...monday, weekStart: 'sun' };
  const other = { freq: 'weekly', interval: 2, byWeekday: ['mon', 'fri'], weekStart: 'wed', start: '2025-03-03' };
  const mondayDays = ['2025-03-02', '2025-03-12', '2025-03-16', '2025-03-26', '2025-03-30'];
  assert.deepEqual(occurrences(sunday, { to: '2025-04-05' }), ['2025-03-02', '2025-03-05', '2025-03-16', '2025-03-19', '2025-03-30', '2025-04-02']);
  assert.deepEqual(occurrences(monday, { to: '2025-04-05' }), mondayDays);
  assert.deepEqual(occurrences(other, { to: '2025-03-31' }), ['2025-03-03', '2025-03-14', '2025-03-17', '2025-03-28', '2025-03-31']);
  assert.deepEqual(occurrences({ ...other, weekStart: undefined }, { to: '2025-03-31' }), ['2025-03-03', '2025-03-07', '2025-03-17', '2025-03-21', '2025-03-31']);
  assert.equal(occursOn(monday, '2025-03-12'), true);
  assert.equal(occursOn(monday, '2025-03-05'), false);
});
