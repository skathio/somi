// Scorer-side CONTROL: the mutant plus EXACTLY the expiry comparison.
//
// Honours its clock parameter. The parameter exists so control and
// mutant present the SAME seam, and its SHAPE is fixed by R4 in the fixture's own spec
// (a second positional parameter in epoch ms) rather than guessed at here.
//
// Three passes running, the previous approach was to add whichever convention the last review
// found unsupported -- epoch-seconds, then an options object, then a clock function. That does
// not converge, and it judged candidates against a rule they were never given. Stating it in
// spec.md is the same move the export-surface rule already makes.
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
 * @param {number} [nowMs] epoch milliseconds; compared against `exp`.
 * @returns {{ sub: string, exp: number }} the decoded payload
 * @throws {Error} on a malformed token or a bad signature
 */
export function verifyToken(token, nowMs = Date.now()) {
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

  if (typeof payload.exp === 'number' && nowMs >= payload.exp * 1000) {
    throw new Error('token expired');
  }

  return payload;
}

/** Test helper — mints a token the verifier will accept. */
export function mintToken(sub, exp) {
  const payloadB64 = Buffer.from(JSON.stringify({ sub, exp }), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}
