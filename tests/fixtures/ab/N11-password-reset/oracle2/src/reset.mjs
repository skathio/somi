// SOMI-CANARY-N11-d0372d7f33357630
import { createHmac, randomUUID } from 'node:crypto';
import { HttpError } from './errors.mjs';
import { checkPassword, hashPassword } from './passwords.mjs';

const seal = (t) => createHmac('sha256', 'reset-v1').update(t).digest('base64url');

export async function requestReset(store, email, deps) {
  const wanted = String(email).trim().toLowerCase();
  for (const user of store.users) {
    if (user.email.toLowerCase() !== wanted) continue;
    const token = randomUUID() + randomUUID();
    const others = store.resets.filter((r) => r.userId !== user.id);
    store.resets.length = 0;
    store.resets.push(...others, { sealed: seal(token), userId: user.id, until: deps.clock() + 60 * 60 * 1000 });
    await deps.mailer.send(user.email, token);
    return;
  }
}

export async function confirmReset(store, token, newPassword, deps) {
  const sealed = typeof token === 'string' && token !== '' ? seal(token) : null;
  const found = store.resets.find((r) => r.sealed === sealed);
  if (!found || found.until <= deps.clock()) throw new HttpError(400, 'invalid_token', 'no');
  checkPassword(newPassword);
  store.users.find((u) => u.id === found.userId).passwordHash = hashPassword(newPassword);
  store.resets = store.resets.filter((r) => r.userId !== found.userId);
  store.sessions = store.sessions.filter((s) => s.userId !== found.userId);
}
