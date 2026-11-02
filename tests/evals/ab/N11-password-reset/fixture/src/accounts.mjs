import { checkPassword, hashPassword } from './passwords.mjs';

export function register(store, id, email, password) {
  checkPassword(password);
  store.users.push({ id, email, passwordHash: hashPassword(password) });
}
