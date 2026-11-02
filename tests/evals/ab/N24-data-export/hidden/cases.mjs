// SOMI-CANARY-N24-16961b546abff2c4
const DAY = 86400000;
const store = () => ({
  users: [{ id: 'a', email: 'a@x', passwordHash: 'HASH', staffNotes: 'difficult', name: 'Ann' }, { id: 'b', email: 'b@x', passwordHash: 'H2', staffNotes: '', name: 'Bo' }],
  orders: [{ id: 'o1', userId: 'a', total: 5 }, { id: 'o2', userId: 'b', total: 6 }, { id: 'o3', userId: 'a', total: 7 }],
  tickets: [{ id: 't1', userId: 'a', text: 'help', assignee: 'Sam', internal: 'refund abuse?' }, { id: 't2', userId: 'b', text: 'x', assignee: 'Sam' }],
  audit: [],
});
const X = (l) => l('src/export.mjs');
const code = (f) => { try { f(); return null; } catch (e) { return [e.status, e.code]; } };
const self = { id: 'a' }; const admin = { id: 'root', admin: true };
export const cases = [
  { name: 'AC2 [functional] the export has the agreed shape and only that person', run: async (l) => (await X(l)).exportUserData(store(), 'a', self, 100), expect: { profile: { id: 'a', email: 'a@x', name: 'Ann' }, orders: [{ id: 'o1', userId: 'a', total: 5 }, { id: 'o3', userId: 'a', total: 7 }], tickets: [{ id: 't1', userId: 'a', text: 'help' }], exportedAt: 100 } },
  { name: 'AC2 [safety] nothing secret appears anywhere in it', run: async (l) => { const t = JSON.stringify((await X(l)).exportUserData(store(), 'a', self, 100)); return ['HASH', 'difficult', 'Sam', 'refund abuse'].filter((s) => t.includes(s)); }, expect: [] },
  { name: 'AC2 [functional] the store is not changed by the filtering', run: async (l) => { const s = store(); (await X(l)).exportUserData(s, 'a', self, 100); return [s.users[0].passwordHash, s.tickets[0].assignee]; }, expect: ['HASH', 'Sam'] },
  { name: 'AC2 [functional] an admin can export anyone, with the same limits on content', run: async (l) => { const t = (await X(l)).exportUserData(store(), 'b', admin, 100); return [t.profile.id, JSON.stringify(t).includes('H2')]; }, expect: ['b', false] },
  { name: 'AC2 [safety] someone else is forbidden', run: async (l) => { const m = await X(l); const s = store(); return { c: code(() => m.exportUserData(s, 'a', { id: 'b' }, 1)), audit: s.audit.length }; }, expect: { c: [403, 'forbidden'], audit: 0 } },
  { name: 'AC2 [functional] an export is recorded', run: async (l) => { const s = store(); (await X(l)).exportUserData(s, 'a', admin, 100); return s.audit; }, expect: [{ type: 'data.exported', userId: 'a', by: 'root', at: 100 }] },
  { name: 'AC2 [boundary] a person can export once a day', run: async (l) => { const m = await X(l); const s = store(); m.exportUserData(s, 'a', self, 100); return [code(() => m.exportUserData(s, 'a', self, 100 + DAY - 1)), code(() => m.exportUserData(s, 'a', self, 100 + DAY))]; }, expect: [[429, 'too_many_exports'], null] },
  { name: 'AC2 [boundary] an admin is not limited', run: async (l) => { const m = await X(l); const s = store(); m.exportUserData(s, 'a', self, 100); m.exportUserData(s, 'a', admin, 101); return code(() => m.exportUserData(s, 'a', admin, 102)); }, expect: null },
  { name: 'AC2 [boundary] an admin export does not use up the allowance', run: async (l) => { const m = await X(l); const s = store(); m.exportUserData(s, 'a', admin, 100); return code(() => m.exportUserData(s, 'a', self, 101)); }, expect: null },
  { name: 'AC2 [boundary] one person using the allowance does not limit another', run: async (l) => { const m = await X(l); const s = store(); m.exportUserData(s, 'a', self, 100); return code(() => m.exportUserData(s, 'b', { id: 'b' }, 101)); }, expect: null },
  { name: 'AC3 [functional] an unknown user is not found', run: async (l) => { const m = await X(l); return code(() => m.exportUserData(store(), 'zz', admin, 1)); }, expect: [404, 'not_found'] },
  { name: 'AC3 [regression] users can still be read', run: async (l) => (await l('src/users.mjs')).getUser(store(), 'a').passwordHash, expect: 'HASH' },
];
