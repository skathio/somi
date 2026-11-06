// SOMI-CANARY-N14-2151bb3314e52d28
import { createHash } from 'node:crypto';

const bucket = (n, u) => createHash('sha256').update(`${n}:${u}`).digest().readUInt32BE(0) % 100;
const users = Array.from({ length: 200 }, (_, i) => 'u' + i);
async function w(l) { const f = await l('src/flags.mjs'); const a = await l('src/admin.mjs'); const store = { flags: [], cache: new Map(), audit: [] }; return { store, on: (n, u) => f.isEnabled(store, n, u), set: (flag) => a.setFlag(store, flag, 'admin', 7) }; }
const code = (fn) => { try { fn(); return null; } catch (e) { return [e.status, e.code]; } };
export const cases = [
  { name: 'AC1 [functional] the percent picks exactly the users whose bucket is below it', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: true, percent: 30 }); return users.every((u) => x.on('f', u) === (bucket('f', u) < 30)); }, expect: true },
  { name: 'AC1 [functional] two flags pick different users', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: true, percent: 50 }); x.set({ name: 'g', enabled: true, percent: 50 }); return users.every((u) => x.on('g', u) === (bucket('g', u) < 50)) && users.some((u) => x.on('f', u) !== x.on('g', u)); }, expect: true },
  { name: 'AC1 [boundary] percent 0 is nobody, percent 100 is everybody', run: async (l) => { const x = await w(l); x.set({ name: 'a', enabled: true, percent: 0 }); x.set({ name: 'b', enabled: true, percent: 100 }); return [users.some((u) => x.on('a', u)), users.every((u) => x.on('b', u))]; }, expect: [false, true] },
  { name: 'AC1 [functional] deny beats allow', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: true, allow: ['u1'], deny: ['u1'] }); return x.on('f', 'u1'); }, expect: false },
  { name: 'AC1 [functional] allow works with the flag off and outside the percent', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: false, percent: 0, allow: ['u1'] }); return [x.on('f', 'u1'), x.on('f', 'u2')]; }, expect: [true, false] },
  { name: 'AC1 [regression] a disabled flag ignores its percent', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: false, percent: 100 }); return users.some((u) => x.on('f', u)); }, expect: false },
  { name: 'AC2 [boundary] a change is seen at once even after the flag was read', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: true, deny: [] }); const before = x.on('f', 'u1'); x.set({ name: 'f', enabled: true, deny: ['u1'] }); return [before, x.on('f', 'u1')]; }, expect: [true, false] },
  { name: 'AC3 [boundary] percents outside 0 to 100 or not whole are refused', run: async (l) => { const x = await w(l); return [-1, 101, 1.5, '5'].map((percent) => code(() => x.set({ name: 'f', enabled: true, percent }))); }, expect: Array(4).fill([400, 'invalid_flag']) },
  { name: 'AC3 [boundary] lists that are not arrays are refused and nothing is saved', run: async (l) => { const x = await w(l); const c = [code(() => x.set({ name: 'f', enabled: true, allow: 'u1' })), code(() => x.set({ name: 'f', enabled: true, deny: 'u1' }))]; return { c, flags: x.store.flags.length, audit: x.store.audit.length }; }, expect: { c: [[400, 'invalid_flag'], [400, 'invalid_flag']], flags: 0, audit: 0 } },
  { name: 'AC2 [regression] saving a flag is still audited', run: async (l) => { const x = await w(l); x.set({ name: 'f', enabled: true }); return x.store.audit; }, expect: [{ type: 'flag.changed', name: 'f', actor: 'admin', at: 7 }] },
];
