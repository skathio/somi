// SOMI-CANARY-N07-9a88ac1f8da53c10
import { HttpError } from './errors.mjs';

const emailKey = (email) => email.trim().toLowerCase();

function check(row) {
  const email = typeof row.email === 'string' ? row.email.trim() : '';
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) throw new HttpError(422, 'invalid_email', 'that is not an email');
  if (row.plan !== undefined && row.plan !== 'free' && row.plan !== 'paid') throw new HttpError(422, 'invalid_plan', 'no such plan');
}

function commit(store, user, now) {
  const id = store.nextId++;
  const saved = { id, plan: 'free', ...user, createdAt: now };
  store.users.push(saved);
  store.audit.push({ type: 'user.added', id, at: now });
  return saved;
}

export function addUser(store, row, now) {
  check(row);
  if (store.users.some((u) => emailKey(u.email) === emailKey(row.email))) throw new HttpError(409, 'email_taken', 'that email is in use');
  return commit(store, { ...row, email: row.email.trim() }, now);
}

export function importUsers(store, rows, now) {
  const seen = new Set(store.users.map((u) => emailKey(u.email)));
  const prepared = [];
  rows.forEach((row, index) => {
    try {
      check(row);
      if (seen.has(emailKey(row.email))) throw new HttpError(409, 'email_taken', 'that email is in use');
    } catch (e) {
      throw Object.assign(new HttpError(422, 'import_invalid', e.message), { row: index });
    }
    seen.add(emailKey(row.email));
    const user = { ...row, email: row.email.trim() };
    prepared.push(user);
  });
  for (const user of prepared) commit(store, user, now);
  return prepared.length;
}
