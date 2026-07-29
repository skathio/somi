// Reference copy of token.mjs without expiry enforcement. Not imported by the application.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = 'fixture-secret-not-a-real-key';

function sign(payloadB64) {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

/**
 * @param {string} token  `<payloadB64>.<sig>`
 * @returns {{ sub: string, exp: number }} the decoded payload
 * @throws {Error} on a malformed token or a bad signature
 */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new Error('malformed token');
  }
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) throw new Error('malformed token');

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('bad signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('malformed token');
  }

  // NOTE: payload.exp is decoded and returned, but never compared against the clock.
  return payload;
}

/** Test helper — mints a token the verifier will accept. */
export function mintToken(sub, exp) {
  const payloadB64 = Buffer.from(JSON.stringify({ sub, exp }), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}
