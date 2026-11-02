import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUser } from '../src/users.mjs';

test('finds a user', () => {
  assert.equal(getUser({ users: [{ id: 'a' }] }, 'a').id, 'a');
});
