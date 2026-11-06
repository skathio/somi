import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUser, register } from '../src/accounts.mjs';

test('register then get', () => {
  const store = { users: [], invoices: [], sessions: [], audit: [] };
  register(store, { id: 'u1', email: 'a@x.test', name: 'A' }, 1);
  assert.equal(getUser(store, 'u1').email, 'a@x.test');
});
