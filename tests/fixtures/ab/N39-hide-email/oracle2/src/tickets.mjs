// SOMI-CANARY-N39-21c2acaf1fd9a27c
import { displayName } from './names.mjs';

const find = (list, id) => list.find((x) => x.id === id);

export function getTicket(store, viewer, id) {
  const t = find(store.tickets, id);
  const author = find(store.users, t.authorId);
  const shown = { id: author.id, name: displayName(viewer, author) };
  if (viewer.admin) shown.email = author.email;
  return { id: t.id, subject: t.subject, author: shown, replies: t.replies.map((r) => ({ by: displayName(viewer, find(store.users, r.userId)), body: r.body })) };
}

export function exportTickets(store, viewer) {
  const lines = store.tickets.map((t) => {
    const a = find(store.users, t.authorId);
    return `${t.id},${t.subject},${displayName(viewer, a)},${viewer.admin ? a.email : ''}`;
  });
  return ['id,subject,name,email', ...lines].join('\n');
}

export function previewNotification(store, viewer, ticketId) {
  const t = find(store.tickets, ticketId);
  const a = find(store.users, t.authorId);
  const out = { subject: `Update on ${t.subject}`, body: `Hello ${displayName(viewer, a)}` };
  if (viewer.admin) out.to = a.email;
  return out;
}
