// SOMI-CANARY-N07-9a88ac1f8da53c10
import { HttpError } from './errors.mjs';

const key = (e) => e.trim().toLowerCase();
const VALID_EMAIL = /^[^@]+@.+$/;

function problem(row, taken) {
  const email = String(row.email ?? '').trim();
  if (!VALID_EMAIL.test(email)) return 'invalid_email';
  if (row.plan !== undefined && !['free', 'paid'].includes(row.plan)) return 'invalid_plan';
  if (taken.has(key(email))) return 'email_taken';
  return null;
}

function add(store, row, now) {
  const user = { id: store.nextId, plan: 'free', ...row, email: row.email.trim(), createdAt: now };
  store.nextId += 1;
  store.users.push(user);
  store.audit.push({ type: 'user.added', id: user.id, at: now });
  return user;
}

export function addUser(store, row, now) {
  const p = problem(row, new Set(store.users.map((u) => key(u.email))));
  if (p) throw new HttpError(p === 'email_taken' ? 409 : 422, p, p);
  return add(store, row, now);
}

export function importUsers(store, rows, now) {
  const taken = new Set(store.users.map((u) => key(u.email)));
  for (let i = 0; i < rows.length; i++) {
    const p = problem(rows[i], taken);
    if (p) { const e = new HttpError(422, 'import_invalid', p); e.row = i; throw e; }
    taken.add(key(rows[i].email));
  }
  rows.forEach((r) => add(store, r, now));
  return rows.length;
}
