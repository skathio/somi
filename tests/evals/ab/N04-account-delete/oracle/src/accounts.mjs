// SOMI-CANARY-N04-c4217c05b55c1a11
import { HttpError } from './errors.mjs';

const live = (store) => store.users.filter((u) => !u.closedAt);

export function register(store, { id, email, name, phone = null }, now) {
  if (live(store).some((u) => u.email === email)) throw new HttpError(409, 'email_taken', 'that email is in use');
  const user = { id, email, name, phone, createdAt: now };
  store.users.push(user);
  store.audit.push({ type: 'account.created', userId: id, at: now });
  return user;
}

export function getUser(store, id) {
  const user = store.users.find((u) => u.id === id);
  if (!user) throw new HttpError(404, 'not_found', 'no such user');
  return user;
}

export const findByEmail = (store, email) => live(store).find((u) => u.email === email) ?? null;
export function listUsers(store) {
  return store.users.filter((u) => !u.closedAt);
}

export function signIn(store, email, sessionId) {
  const user = findByEmail(store, email);
  if (!user) throw new HttpError(401, 'bad_credentials', 'no such account');
  store.sessions.push({ id: sessionId, userId: user.id });
  return sessionId;
}

export function closeAccount(store, userId, now) {
  const user = getUser(store, userId);
  if (user.closedAt) return user;
  user.closedAt = now;
  user.email = `closed-${user.id}@invalid`;
  user.name = null;
  user.phone = null;
  store.sessions = store.sessions.filter((s) => s.userId !== userId);
  store.audit.push({ type: 'account.closed', userId, at: now });
  return user;
}
