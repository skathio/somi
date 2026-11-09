import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../src/accounts.mjs';
import { verifyPassword } from '../src/passwords.mjs';

test('register keeps a hash', () => {
  const store = { users: [], sessions: [], resets: [] };
  register(store, 'u1', 'a@x.test', 'long enough password');
  assert.ok(verifyPassword('long enough password', store.users[0].passwordHash));
});
