// SOMI-CANARY-N11-d0372d7f33357630
const HOUR = 3600000; const NEW = 'a brand new password';
async function world(l) {
  const r = await l('src/reset.mjs'); const a = await l('src/accounts.mjs'); const p = await l('src/passwords.mjs');
  const store = { users: [], sessions: [{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u2' }], resets: [] };
  a.register(store, 'u1', 'ann@x.test', 'the first password'); a.register(store, 'u2', 'bo@x.test', 'another password');
  let t = 1000000; const mail = [];
  const deps = { clock: () => t, mailer: { send: async (email, token) => { mail.push({ email, token }); } } };
  return { ...r, ...p, store, deps, mail, advance: (ms) => { t += ms; }, u1: () => store.users[0] };
}
const code = async (f) => { try { await f(); return null; } catch (e) { return e.code ?? e.name; } };
export const cases = [
  { name: 'AC2 [functional] the mailed token sets the new password', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); await w.confirmReset(w.store, w.mail[0].token, NEW, w.deps); return { to: w.mail[0].email, ok: w.verifyPassword(NEW, w.u1().passwordHash) }; }, expect: { to: 'ann@x.test', ok: true } },
  { name: 'AC3 [boundary] a token still works just inside the hour', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); w.advance(HOUR - 1); return code(() => w.confirmReset(w.store, w.mail[0].token, NEW, w.deps)); }, expect: null },
  { name: 'AC3 [boundary] a token is dead at the hour', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); w.advance(HOUR); return code(() => w.confirmReset(w.store, w.mail[0].token, NEW, w.deps)); }, expect: 'invalid_token' },
  { name: 'AC3 [functional] a made-up token is refused', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); return code(() => w.confirmReset(w.store, 'made-up', NEW, w.deps)); }, expect: 'invalid_token' },
  { name: 'AC3 [safety] [unprompted] a token works once', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); await w.confirmReset(w.store, w.mail[0].token, NEW, w.deps); return code(() => w.confirmReset(w.store, w.mail[0].token, 'yet another password', w.deps)); }, expect: 'invalid_token' },
  { name: 'AC3 [safety] [unprompted] a newer request kills the older token', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); await w.requestReset(w.store, 'ann@x.test', w.deps); return { old: await code(() => w.confirmReset(w.store, w.mail[0].token, NEW, w.deps)), fresh: await code(() => w.confirmReset(w.store, w.mail[1].token, NEW, w.deps)) }; }, expect: { old: 'invalid_token', fresh: null } },
  { name: 'AC1 [safety] [unprompted] the token itself is not kept where a database leak would expose it', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); return JSON.stringify(w.store).includes(w.mail[0].token); }, expect: false },
  { name: 'AC1 [safety] [unprompted] the token cannot be guessed', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); await w.requestReset(w.store, 'bo@x.test', w.deps); return w.mail[0].token.length >= 32 && w.mail[0].token !== w.mail[1].token; }, expect: true },
  { name: 'AC1 [safety] [unprompted] an unknown address looks the same as a known one', run: async (l) => { const w = await world(l); const known = await w.requestReset(w.store, 'ann@x.test', w.deps); const before = w.mail.length; let err = null; let unknown; try { unknown = await w.requestReset(w.store, 'nobody@x.test', w.deps); } catch (e) { err = e.code ?? e.name; } return { err, same: known === unknown, mailed: w.mail.length - before }; }, expect: { err: null, same: true, mailed: 0 } },
  { name: 'AC2 [safety] [unprompted] a reset ends the sessions of that account only', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); await w.confirmReset(w.store, w.mail[0].token, NEW, w.deps); return w.store.sessions.map((s) => s.id); }, expect: ['s2'] },
  { name: 'AC4 [functional] a weak password is refused and the token survives', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); const weak = await code(() => w.confirmReset(w.store, w.mail[0].token, 'short', w.deps)); const then = await code(() => w.confirmReset(w.store, w.mail[0].token, NEW, w.deps)); return { weak, then }; }, expect: { weak: 'weak_password', then: null } },
  { name: 'AC4 [safety] the new password is stored hashed', run: async (l) => { const w = await world(l); await w.requestReset(w.store, 'ann@x.test', w.deps); await w.confirmReset(w.store, w.mail[0].token, NEW, w.deps); return JSON.stringify(w.store).includes(NEW); }, expect: false },
  { name: 'AC2 [regression] registering still works', run: async (l) => { const a = await l('src/accounts.mjs'); const s = { users: [] }; a.register(s, 'x', 'x@x.test', 'long enough password'); return s.users.length; }, expect: 1 },
];
