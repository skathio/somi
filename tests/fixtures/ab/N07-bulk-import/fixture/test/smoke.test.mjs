import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser } from '../src/users.mjs';

test('adds a user', () => {
  const store = { users: [], audit: [], nextId: 1 };
  assert.equal(addUser(store, { email: 'a@x.test' }, 5).id, 1);
});
