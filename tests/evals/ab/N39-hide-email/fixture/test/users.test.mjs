import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUser } from '../src/users.mjs';

test('an admin sees a user', () => {
  const store = { users: [{ id: 'u', name: 'A', email: 'a@x.test', plan: 'pro' }] };
  assert.equal(getUser(store, { admin: true }, 'u').email, 'a@x.test');
});
