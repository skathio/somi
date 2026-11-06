// SOMI-CANARY-N07-9a88ac1f8da53c10
const U = (l) => l('src/users.mjs');
const fresh = () => ({ users: [{ id: 1, email: 'Old@x.test', plan: 'free', createdAt: 1 }], audit: [], nextId: 2 });
const fails = async (l, rows) => { const m = await U(l); const s = fresh(); const before = JSON.stringify(s); let err = {}; try { m.importUsers(s, rows, 9); } catch (e) { err = e; } return { status: err.status, code: err.code, row: err.row, same: JSON.stringify(s) === before }; };
const bad = (row) => ({ status: 422, code: 'import_invalid', row, same: true });
export const cases = [
  { name: 'AC3 [functional] it returns how many were added, with ids and audit in order', run: async (l) => { const m = await U(l); const s = fresh(); const n = m.importUsers(s, [{ email: 'a@x.test' }, { email: 'b@x.test', plan: 'paid' }], 9); return { n, ids: s.users.map((u) => u.id), plans: s.users.map((u) => u.plan), audit: s.audit, next: s.nextId }; }, expect: { n: 2, ids: [1, 2, 3], plans: ['free', 'free', 'paid'], audit: [{ type: 'user.added', id: 2, at: 9 }, { type: 'user.added', id: 3, at: 9 }], next: 4 } },
  { name: 'AC2 [functional] a bad row anywhere leaves everything as it was', run: (l) => fails(l, [{ email: 'a@x.test' }, { email: 'nope' }, { email: 'c@x.test' }]), expect: bad(1) },
  { name: 'AC2 [functional] a clash with an existing user is a bad row', run: (l) => fails(l, [{ email: 'a@x.test' }, { email: 'Old@x.test' }]), expect: bad(1) },
  { name: 'AC4 [boundary] a clash differing only by case and space is a bad row', run: (l) => fails(l, [{ email: ' old@X.test ' }]), expect: bad(0) },
  { name: 'AC4 [boundary] a duplicate inside the import is a bad row', run: (l) => fails(l, [{ email: 'a@x.test' }, { email: 'b@x.test' }, { email: 'A@X.test' }]), expect: bad(2) },
  { name: 'AC4 [boundary] an email with nothing before or after the @ is a bad row', run: (l) => fails(l, [{ email: '@x.test' }, { email: 'a@' }]), expect: bad(0) },
  { name: 'AC4 [boundary] a plan that does not exist is a bad row', run: (l) => fails(l, [{ email: 'a@x.test', plan: '' }]), expect: bad(0) },
  { name: 'AC2 [boundary] the id counter does not move on a failed import', run: async (l) => { const m = await U(l); const s = fresh(); try { m.importUsers(s, [{ email: 'a@x.test' }, { email: 'bad' }], 9); } catch { /* expected */ } m.importUsers(s, [{ email: 'z@x.test' }], 9); return s.users.at(-1).id; }, expect: 2 },
  { name: 'AC4 [boundary] stored emails have their surrounding space removed', run: async (l) => { const m = await U(l); const s = fresh(); m.importUsers(s, [{ email: '  a@x.test ' }], 9); return s.users.at(-1).email; }, expect: 'a@x.test' },
  { name: 'AC2 [boundary] a failed import does not touch the rows it was given', run: async (l) => { const m = await U(l); const rows = [{ email: '  a@x.test ' }, { email: 'bad' }]; let code = null; try { m.importUsers(fresh(), rows, 9); } catch (e) { code = e.code; } return { code, rows }; }, expect: { code: 'import_invalid', rows: [{ email: '  a@x.test ' }, { email: 'bad' }] } },
  { name: 'AC4 [functional] one user at a time follows the same uniqueness rule', run: async (l) => { const m = await U(l); const s = fresh(); try { m.addUser(s, { email: 'old@x.test' }, 9); return 'added'; } catch (e) { return { code: e.code, next: s.nextId }; } }, expect: { code: 'email_taken', next: 2 } },
  { name: 'AC4 [regression] a plain add still works', run: async (l) => { const m = await U(l); const s = fresh(); return m.addUser(s, { email: 'n@x.test' }, 9).plan; }, expect: 'free' },
];
