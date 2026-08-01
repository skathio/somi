// Session loading. Verifies the token, then applies its own expiry check.
import { verifyToken } from './token.mjs';

export function loadSession(token, now = Date.now()) {
  const payload = verifyToken(token);
  if (payload.exp * 1000 < now) {
    throw new Error('session expired');
  }
  return { sub: payload.sub };
}
