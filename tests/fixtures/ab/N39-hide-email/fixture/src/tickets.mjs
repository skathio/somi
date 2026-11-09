import { displayName } from './names.mjs';

const userOf = (store, id) => store.users.find((u) => u.id === id);

export function getTicket(store, viewer, id) {
  const t = store.tickets.find((x) => x.id === id);
  const author = userOf(store, t.authorId);
  return {
    id: t.id,
    subject: t.subject,
    author: { id: author.id, name: displayName(viewer, author), email: author.email },
    replies: t.replies.map((r) => ({ by: displayName(viewer, userOf(store, r.userId)), body: r.body })),
  };
}

export function exportTickets(store, viewer) {
  const rows = store.tickets.map((t) => {
    const author = userOf(store, t.authorId);
    return [t.id, t.subject, displayName(viewer, author), author.email].join(',');
  });
  return ['id,subject,name,email', ...rows].join('\n');
}

export function previewNotification(store, viewer, ticketId) {
  const t = store.tickets.find((x) => x.id === ticketId);
  const author = userOf(store, t.authorId);
  return { to: author.email, subject: `Update on ${t.subject}`, body: `Hello ${displayName(viewer, author)}` };
}
