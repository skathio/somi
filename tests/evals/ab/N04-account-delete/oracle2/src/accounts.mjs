// SOMI-CANARY-N04-c4217c05b55c1a11
import { HttpError } from './errors.mjs';

const isOpen = (u) => u.closedAt == null;

export const listUsers = (store) => store.users.filter(isOpen);
export const findByEmail = (store, email) => listUsers(store).find((u) => u.email === email) ?? null;

export function register(store, { id, email, name, phone = null }, now) {
  if (findByEmail(store, email)) throw new HttpError(409, 'email_taken', 'that email is in use');
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

export function signIn(store, email, sessionId) {
  const user = findByEmail(store, email);
  if (!user) throw new HttpError(401, 'bad_credentials', 'no such account');
  store.sessions.push({ id: sessionId, userId: user.id });
  return sessionId;
}

export function closeAccount(store, userId, now) {
  const user = getUser(store, userId);
  if (!isOpen(user)) return user;
  Object.assign(user, { closedAt: now, email: 'closed-' + user.id + '@invalid', name: null, phone: null });
  for (let i = store.sessions.length - 1; i >= 0; i--) if (store.sessions[i].userId === userId) store.sessions.splice(i, 1);
  store.audit.push({ type: 'account.closed', userId, at: now });
}
