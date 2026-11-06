// SOMI-CANARY-N24-16961b546abff2c4
import { HttpError } from './errors.mjs';
import { getUser } from './users.mjs';

const DAY = 86400000;

export function exportUserData(store, userId, requester, now) {
  const user = getUser(store, userId);
  if (!requester.admin && requester.id !== userId) throw new HttpError(403, 'forbidden', 'not yours');
  const recent = store.audit.some((e) => e.type === 'data.exported' && e.userId === userId && e.by === userId && now - e.at < DAY);
  if (!requester.admin && recent) throw new HttpError(429, 'too_many_exports', 'once a day');
  const { passwordHash, staffNotes, ...profile } = user;
  const tickets = store.tickets.filter((t) => t.userId === userId).map(({ internal, ...t }) => {
    const { assignee, ...rest } = t;
    return rest;
  });
  store.audit.push({ type: 'data.exported', userId, by: requester.id, at: now });
  return { profile, orders: store.orders.filter((o) => o.userId === userId), tickets, exportedAt: now };
}
