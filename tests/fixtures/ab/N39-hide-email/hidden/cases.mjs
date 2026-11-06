// SOMI-CANARY-N39-21c2acaf1fd9a27c
import { createHash } from 'node:crypto';

const STAFF = { admin: false };
const ADMIN = { admin: true };
const EMAILS = ['zed@x.test', 'ann@x.test', 'nameless@x.test'];
const md5 = (e) => createHash('md5').update(e).digest('hex');
async function W(l) {
  const m = {};
  for (const f of ['store', 'users', 'tickets', 'audit']) Object.assign(m, await l(`src/${f}.mjs`));
  const s = m.createStore();
  s.users.push({ id: 'u1', name: 'Mia', email: EMAILS[0], plan: 'pro' }, { id: 'u2', name: 'Bo', email: EMAILS[1], plan: 'free' }, { id: 'u3', name: '', email: EMAILS[2], plan: 'free' });
  s.tickets.push({ id: 't1', subject: 'Help', authorId: 'u1', replies: [{ userId: 'u3', body: 'hi' }, { userId: 'u2', body: 'yo' }] }, { id: 't2', subject: 'Bill', authorId: 'u3', replies: [] });
  s.audit.push({ action: 'reset', detail: `password reset sent to ${EMAILS[1]} by support` }, { action: 'login', detail: 'from 10.0.0.1' });
  return { ...m, s };
}
const leaks = (value) => { const text = JSON.stringify(value) ?? ''; return EMAILS.filter((e) => text.includes(e) || text.includes(md5(e)) || text.includes(e.split('@')[0] + '@')); };
export const cases = [
  { name: 'AC2 [safety] a user read shows no email', run: async (l) => { const x = await W(l); return leaks(x.getUser(x.s, STAFF, 'u1')); }, expect: [] },
  { name: 'AC2 [safety] a user list and a ticket show no email', run: async (l) => { const x = await W(l); return [leaks(x.listUsers(x.s, STAFF)), leaks(x.getTicket(x.s, STAFF, 't1'))]; }, expect: [[], []] },
  { name: 'AC2 [safety] a customer with no name is not shown by their email', run: async (l) => { const x = await W(l); return [leaks(x.getUser(x.s, STAFF, 'u3')), leaks(x.getTicket(x.s, STAFF, 't2')), leaks(x.getTicket(x.s, STAFF, 't1').replies)]; }, expect: [[], [], []] },
  { name: 'AC2 [safety] the avatar address does not give the email away', run: async (l) => { const x = await W(l); return leaks(x.listUsers(x.s, STAFF).map((u) => u.avatar)); }, expect: [] },
  { name: 'AC2 [safety] the export has no email', run: async (l) => { const x = await W(l); return leaks(x.exportTickets(x.s, STAFF)); }, expect: [] },
  { name: 'AC2 [safety] a notification preview has no email', run: async (l) => { const x = await W(l); return [leaks(x.previewNotification(x.s, STAFF, 't1')), leaks(x.previewNotification(x.s, STAFF, 't2'))]; }, expect: [[], []] },
  { name: 'AC2 [safety] the audit log does not repeat an email in its text', run: async (l) => { const x = await W(l); return leaks(x.listAudit(x.s, STAFF)); }, expect: [] },
  { name: 'AC2 [safety] searching cannot be used to test an email', run: async (l) => { const x = await W(l); return [x.searchUsers(x.s, STAFF, 'zed@x').length, x.searchUsers(x.s, STAFF, 'x.test').length, x.searchUsers(x.s, STAFF, 'nameless').length]; }, expect: [0, 0, 0] },
  { name: 'AC2 [safety] sorting cannot be used to learn email order', run: async (l) => { const x = await W(l); let order = null; try { order = x.listUsers(x.s, STAFF, { sort: 'email' }).map((u) => u.id); } catch { return 'refused'; } return order.join() === 'u2,u3,u1' ? 'leaked' : 'refused'; }, expect: 'refused' },
  { name: 'AC2 [functional] everything else stays visible to staff', run: async (l) => { const x = await W(l); const u = x.getUser(x.s, STAFF, 'u1'); const t = x.getTicket(x.s, STAFF, 't1'); const a = x.listAudit(x.s, STAFF); return [leaks(u).length, u.name, u.plan, t.subject, t.author.name, t.replies[1].by, x.searchUsers(x.s, STAFF, 'mia')[0].id, a[1].detail, a[0].action, /password reset sent to/.test(a[0].detail), x.exportTickets(x.s, STAFF).includes('Mia')]; }, expect: [0, 'Mia', 'pro', 'Help', 'Mia', 'Bo', 'u1', 'from 10.0.0.1', 'reset', true, true] },
  { name: 'AC3 [regression] admins see everything as now', run: async (l) => { const x = await W(l); return [x.getUser(x.s, ADMIN, 'u1').email, x.getUser(x.s, ADMIN, 'u3').name, x.getUser(x.s, ADMIN, 'u1').avatar.endsWith(md5(EMAILS[0])), x.searchUsers(x.s, ADMIN, 'zed@x').length, x.listUsers(x.s, ADMIN, { sort: 'email' }).map((u) => u.id), x.getTicket(x.s, ADMIN, 't1').author.email, x.exportTickets(x.s, ADMIN).includes(EMAILS[0]), x.previewNotification(x.s, ADMIN, 't1').to, x.listAudit(x.s, ADMIN)[0].detail]; }, expect: [EMAILS[0], EMAILS[2], true, 1, ['u2', 'u3', 'u1'], EMAILS[0], true, EMAILS[0], `password reset sent to ${EMAILS[1]} by support`] },
];
