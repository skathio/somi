import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCode, usageCount } from '../src/coupons.mjs';

test('the helpers', () => {
  assert.equal(normCode(' ab '), 'AB');
  assert.equal(usageCount({ redemptions: [] }, 'AB'), 0);
});
