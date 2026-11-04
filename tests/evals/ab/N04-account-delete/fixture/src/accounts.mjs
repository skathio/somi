import { HttpError } from './errors.mjs';

export function register(store, { id, email, name, phone = null }, now) {
  if (store.users.some((u) => u.email === email)) throw new HttpError(409, 'email_taken', 'that email is in use');
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

export const findByEmail = (store, email) => store.users.find((u) => u.email === email) ?? null;
export const listUsers = (store) => store.users;

export function signIn(store, email, sessionId) {
  const user = findByEmail(store, email);
  if (!user) throw new HttpError(401, 'bad_credentials', 'no such account');
  store.sessions.push({ id: sessionId, userId: user.id });
  return sessionId;
}
