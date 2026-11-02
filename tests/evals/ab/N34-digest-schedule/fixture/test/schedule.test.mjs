import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRun } from '../src/schedule.mjs';

test('a run later today', () => {
  assert.equal(nextRun(Date.UTC(2026, 5, 1, 1), { time: '09:00', zone: 'UTC' }), Date.UTC(2026, 5, 1, 9));
});
