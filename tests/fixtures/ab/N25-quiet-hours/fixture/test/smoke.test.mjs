import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueNow } from '../src/schedule.mjs';

test('what is due', () => {
  assert.deepEqual(dueNow([{ at: 1 }, { at: 3 }], 2), [{ at: 1 }]);
});
