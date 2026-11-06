import { HttpError } from './errors.mjs';

function validate(row) {
  row.email = row.email.trim();
  if (!row.email.includes('@')) throw new HttpError(422, 'invalid_email', 'that is not an email');
  if (row.plan && row.plan !== 'free' && row.plan !== 'paid') throw new HttpError(422, 'invalid_plan', 'no such plan');
}

export function addUser(store, row, now) {
  const id = store.nextId++;
  validate(row);
  if (store.users.some((u) => u.email === row.email)) throw new HttpError(409, 'email_taken', 'that email is in use');
  const user = { id, plan: 'free', ...row, createdAt: now };
  store.users.push(user);
  store.audit.push({ type: 'user.added', id, at: now });
  return user;
}
