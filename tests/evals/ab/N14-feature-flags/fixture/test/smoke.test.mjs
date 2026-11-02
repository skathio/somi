import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEnabled } from '../src/flags.mjs';

test('an unknown flag is off', () => {
  assert.equal(isEnabled({ flags: [], cache: new Map(), audit: [] }, 'x', 'u'), false);
});
