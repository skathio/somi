// SOMI-CANARY-N22-8feb28bf341f76ae
const MIN = 60000; const HOUR = 60 * MIN;
async function w(l) { const s = await l('src/sessions.mjs'); const r = await l('src/renew.mjs'); const c = await l('src/sweep.mjs'); const store = { sessions: [] }; s.createSession(store, 's', 'u', 0); return { store, auth: (now) => s.authenticate(store, 's', now), renew: (now) => r.renew(store, 's', now), sweep: (now) => c.sweep(store, now), live: () => store.sessions.length }; }
export const cases = [
  { name: 'AC2 [functional] a request extends the session', run: async (l) => { const x = await w(l); x.auth(20 * MIN); return x.auth(45 * MIN) !== null; }, expect: true },
  { name: 'AC2 [functional] steady work keeps a session going for hours', run: async (l) => { const x = await w(l); let ok = true; for (let t = 25; t < 600; t += 25) ok = ok && x.auth(t * MIN) !== null; return ok; }, expect: true },
  { name: 'AC2 [boundary] at its end a session is already over', run: async (l) => { const x = await w(l); return [x.auth(30 * MIN - 1) !== null, x.auth(60 * MIN - 2) !== null, (await (async () => { const y = await w(l); return y.auth(30 * MIN); })())]; }, expect: [true, true, null] },
  { name: 'AC2 [regression] an idle session ends', run: async (l) => { const x = await w(l); x.auth(10 * MIN); return x.auth(41 * MIN); }, expect: null },
  { name: 'AC2 [boundary] the absolute limit holds however busy it is', run: async (l) => { const x = await w(l); let last; for (let t = 25; t <= 12 * 60 + 25; t += 25) last = x.auth(t * MIN); const end = x.store.sessions[0].expiresAt; return { last, end }; }, expect: { last: null, end: 12 * HOUR } },
  { name: 'AC2 [boundary] a touch close to the limit stops at the limit', run: async (l) => { const x = await w(l); for (let t = 25; t <= 700; t += 25) x.auth(t * MIN); x.auth(715 * MIN); return x.store.sessions[0].expiresAt; }, expect: 12 * HOUR },
  { name: 'AC2 [functional] the mobile refresh extends by the same rule', run: async (l) => { const x = await w(l); return [x.renew(20 * MIN).expiresAt, x.renew(45 * MIN).expiresAt]; }, expect: [50 * MIN, 75 * MIN] },
  { name: 'AC2 [boundary] the mobile refresh cannot revive an ended session', run: async (l) => { const x = await w(l); return x.renew(31 * MIN); }, expect: null },
  { name: 'AC2 [functional] the sweep leaves live sessions alone', run: async (l) => { const x = await w(l); x.sweep(10 * MIN); const a = x.live(); x.auth(20 * MIN); x.sweep(45 * MIN); const b = x.live(); x.sweep(50 * MIN); return [a, b, x.live()]; }, expect: [1, 1, 0] },
  { name: 'AC3 [regression] the settings keep their values', run: async (l) => (await l('src/config.mjs')).config, expect: { sessionMinutes: 30, absoluteHours: 12 } },
  { name: 'AC3 [regression] an unknown session is nothing', run: async (l) => { const s = await l('src/sessions.mjs'); return s.authenticate({ sessions: [] }, 'x', 0); }, expect: null },
];
