import { HttpError } from './errors.mjs';

export function getUser(store, id) {
  const user = store.users.find((u) => u.id === id);
  if (!user) throw new HttpError(404, 'not_found', 'no such user');
  return user;
}
