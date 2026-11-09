import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterSignIn } from '../src/signin.mjs';

test('goes home', () => {
  assert.equal(afterSignIn({ query: {} }).headers.location, '/home');
});
