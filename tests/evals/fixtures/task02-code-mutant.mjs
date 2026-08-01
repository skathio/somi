// Scorer-side MUTANT: expiry enforcement removed.
//
// Takes `now` and ignores it. The parameter exists so that control and mutant present the SAME
// seam: task 02 permits a candidate to inject a clock, and a reference pair driven only by the
// wall clock fails any deterministic test written against a synthetic epoch -- rejecting a
// correct run for using the better test design. Verified: without the seam, a clock-injecting
// candidate with a fixed epoch scored pass 4 / fail 1 on the control.
//
// Reference implementation. Lives OUTSIDE task02-code/ so it never reaches the
// candidate's repo: its existence and its shape are both criterion-revealing. See
// fixtures/README.md. Substituted for src/auth/token.mjs at scoring time.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = 'fixture-secret-not-a-real-key';

function sign(payloadB64) {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

/**
 * @param {string} token  `<payloadB64>.<sig>`
 * @param {number|{now:number}} [now] a clock, in whichever form the caller uses; ignored here.
 * @returns {{ sub: string, exp: number }} the decoded payload
 * @throws {Error} on a malformed token or a bad signature
 */
export function verifyToken(token, now = Date.now()) {
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

  return payload;
}

/** Test helper — mints a token the verifier will accept. */
export function mintToken(sub, exp) {
  const payloadB64 = Buffer.from(JSON.stringify({ sub, exp }), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}
