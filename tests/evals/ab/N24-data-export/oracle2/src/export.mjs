// SOMI-CANARY-N24-16961b546abff2c4
import { HttpError } from './errors.mjs';
import { getUser } from './users.mjs';

const without = (object, ...names) => Object.fromEntries(Object.entries(object).filter(([k]) => !names.includes(k)));

function checkAllowance(store, userId, now) {
  const lastOwn = store.audit.filter((e) => e.type === 'data.exported' && e.userId === userId && e.by === userId).map((e) => e.at);
  if (lastOwn.length && now < Math.max(...lastOwn) + 24 * 3600 * 1000) throw new HttpError(429, 'too_many_exports', 'wait');
}

export function exportUserData(store, userId, requester, now) {
  const user = getUser(store, userId);
  if (requester.admin !== true) {
    if (requester.id !== userId) throw new HttpError(403, 'forbidden', 'no');
    checkAllowance(store, userId, now);
  }
  const result = {
    profile: without(user, 'passwordHash', 'staffNotes'),
    orders: store.orders.filter((o) => o.userId === userId),
    tickets: store.tickets.filter((t) => t.userId === userId).map((t) => without(t, 'assignee', 'internal')),
    exportedAt: now,
  };
  store.audit.push({ type: 'data.exported', userId, by: requester.id, at: now });
  return result;
}
