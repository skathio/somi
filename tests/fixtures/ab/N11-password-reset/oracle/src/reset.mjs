// SOMI-CANARY-N11-d0372d7f33357630
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './errors.mjs';
import { checkPassword, hashPassword } from './passwords.mjs';

const HOUR = 3600000;
const digest = (token) => createHash('sha256').update(token).digest('hex');
const invalid = () => new HttpError(400, 'invalid_token', 'this link cannot be used');

export async function requestReset(store, email, { mailer, clock }) {
  const user = store.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) return;
  const token = randomBytes(32).toString('hex');
  store.resets = store.resets.filter((r) => r.userId !== user.id);
  store.resets.push({ hash: digest(token), userId: user.id, expiresAt: clock() + HOUR });
  await mailer.send(user.email, token);
}

export async function confirmReset(store, token, newPassword, { clock }) {
  const entry = typeof token === 'string' ? store.resets.find((r) => r.hash === digest(token)) : undefined;
  if (!entry || clock() >= entry.expiresAt) throw invalid();
  const user = store.users.find((u) => u.id === entry.userId);
  if (!user) throw invalid();
  checkPassword(newPassword);
  user.passwordHash = hashPassword(newPassword);
  store.resets = store.resets.filter((r) => r.userId !== entry.userId);
  store.sessions = store.sessions.filter((s) => s.userId !== entry.userId);
}
