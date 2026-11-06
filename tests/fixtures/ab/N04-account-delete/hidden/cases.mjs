// SOMI-CANARY-N04-c4217c05b55c1a11
const A = (load) => load('src/accounts.mjs');
function seed(m) {
  const store = { users: [], invoices: [{ id: 'i1', userId: 'u1', total: 9 }], sessions: [], audit: [] };
  m.register(store, { id: 'u1', email: 'a@x.test', name: 'Ann', phone: '555' }, 1);
  m.register(store, { id: 'u2', email: 'b@x.test', name: 'Bo' }, 1);
  m.signIn(store, 'a@x.test', 's1');
  m.signIn(store, 'b@x.test', 's2');
  return store;
}
const closed = async (load, f) => { const m = await A(load); const store = seed(m); m.closeAccount(store, 'u1', 50); return f(m, store); };
const code = (f) => { try { f(); return null; } catch (e) { return e.code ?? e.name; } };
export const cases = [
  { name: 'AC2 [functional] the row and its id stay, with the closing time', run: (l) => closed(l, (m, s) => ({ id: s.users[0].id, closedAt: s.users[0].closedAt })), expect: { id: 'u1', closedAt: 50 } },
  { name: 'AC2 [functional] personal data goes at once', run: (l) => closed(l, (m, s) => { const u = s.users.find((x) => x.id === 'u1'); return { email: u.email, name: u.name, phone: u.phone }; }), expect: { email: 'closed-u1@invalid', name: null, phone: null } },
  { name: 'AC2 [functional] invoices are untouched', run: (l) => closed(l, (m, s) => s.invoices), expect: [{ id: 'i1', userId: 'u1', total: 9 }] },
  { name: 'AC2 [functional] its sessions end, and only its own', run: (l) => closed(l, (m, s) => s.sessions.map((x) => x.id)), expect: ['s2'] },
  { name: 'AC2 [functional] it no longer appears in lists', run: (l) => closed(l, (m, s) => m.listUsers(s).map((u) => u.id)), expect: ['u2'] },
  { name: 'AC2 [functional] looking it up by the old email finds nothing', run: (l) => closed(l, (m, s) => m.findByEmail(s, 'a@x.test')), expect: null },
  { name: 'AC2 [functional] looking it up by its new email finds nothing', run: (l) => closed(l, (m, s) => m.findByEmail(s, 'closed-u1@invalid')), expect: null },
  { name: 'AC2 [functional] it can be read by id, for finance', run: (l) => closed(l, (m, s) => m.getUser(s, 'u1').id), expect: 'u1' },
  { name: 'AC2 [functional] it cannot sign in', run: (l) => closed(l, (m, s) => code(() => m.signIn(s, 'closed-u1@invalid', 's9'))), expect: 'bad_credentials' },
  { name: 'AC2 [functional] the address can come back', run: (l) => closed(l, (m, s) => m.register(s, { id: 'u3', email: 'a@x.test', name: 'New' }, 60).id), expect: 'u3' },
  { name: 'AC2 [functional] the closing is audited', run: (l) => closed(l, (m, s) => s.audit.filter((e) => e.type === 'account.closed')), expect: [{ type: 'account.closed', userId: 'u1', at: 50 }] },
  { name: 'AC3 [boundary] closing twice is harmless and keeps the first time', run: (l) => closed(l, (m, s) => { m.closeAccount(s, 'u1', 70); return { at: s.users.find((x) => x.id === 'u1').closedAt, audits: s.audit.filter((e) => e.type === 'account.closed').length }; }), expect: { at: 50, audits: 1 } },
  { name: 'AC3 [functional] an unknown id is not found', run: (l) => closed(l, (m, s) => code(() => m.closeAccount(s, 'nope', 1))), expect: 'not_found' },
  { name: 'AC3 [regression] a live account can still register and sign in', run: async (l) => { const m = await A(l); const store = seed(m); m.signIn(store, 'a@x.test', 's3'); return store.sessions.length; }, expect: 3 },
];
