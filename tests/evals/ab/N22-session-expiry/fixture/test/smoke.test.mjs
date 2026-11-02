import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, createSession } from '../src/sessions.mjs';

test('a fresh session works', () => {
  const store = { sessions: [] };
  createSession(store, 's', 'u', 1000);
  assert.equal(authenticate(store, 's', 2000).userId, 'u');
});
