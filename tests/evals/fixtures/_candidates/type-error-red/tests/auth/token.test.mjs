import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyToken, mintToken } from '../../src/auth/token.mjs';

const HOUR = 3600;
const nowSec = () => Math.floor(Date.now() / 1000);

test('accepts a validly-signed token', () => {
  const t = mintToken('user-1', nowSec() + HOUR);
  assert.equal(verifyToken(t).sub, 'user-1');
});

test('rejects a tampered signature', () => {
  const t = mintToken('user-1', nowSec() + HOUR);
  const bad = `${t.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  assert.throws(() => verifyToken(bad), /bad signature/);
});

test('rejects malformed input', () => {
  assert.throws(() => verifyToken('not-a-token'), /malformed token/);
  assert.throws(() => verifyToken(''), /malformed token/);
});

const T0 = 1_700_000_000;

// Captures the thrown error to assert on its message. A common pattern -- and against a
// verifier that does NOT throw, `err` is undefined and `err.message` is a TypeError rather than
// an assertion failure.
function captureError(fn) {
  try { fn(); } catch (e) { return e; }
}

test('rejects a token whose exp has passed', () => {
  const err = captureError(() => verifyToken(mintToken('user-1', T0 - 1), T0 * 1000));
  assert.equal(err.message, 'token expired');
});
