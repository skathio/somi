// SOMI-CANARY-N28-d6284be3a22f3812
const D = () => ({ secret: 'k1', store: {} });
const L = (l) => l('src/links.mjs');
const code = (f) => { try { f(); return null; } catch (e) { return [e.status, e.code]; } };
const refused = [403, 'invalid_link'];
export const cases = [
  { name: 'AC2 [functional] a token opens to its file', run: async (l) => { const m = await L(l); const d = D(); return m.openLink(m.createLink('f1', 100, d), 50, d); }, expect: { fileId: 'f1' } },
  { name: 'AC2 [functional] the token fits in a URL', run: async (l) => { const m = await L(l); return /^[A-Za-z0-9._~-]+$/.test(m.createLink('a/b c?é#1', 100, D())); }, expect: true },
  { name: 'AC2 [boundary] awkward file ids come back exactly', run: async (l) => { const m = await L(l); const d = D(); return ['a.b', 'a:b', 'a|b', 'é ü', '../x', '["x"]'].map((id) => m.openLink(m.createLink(id, 100, d), 1, d).fileId); }, expect: ['a.b', 'a:b', 'a|b', 'é ü', '../x', '["x"]'] },
  { name: 'AC3 [boundary] a link works up to, not including, its end', run: async (l) => { const m = await L(l); const d = D(); const t = m.createLink('f', 100, d); return [code(() => m.openLink(t, 99, d)), code(() => m.openLink(t, 100, d))]; }, expect: [null, refused] },
  { name: 'AC2 [safety] [unprompted] changing any single character of a token breaks it', run: async (l) => { const m = await L(l); const d = D(); const t = m.createLink('f1', 100, d); const out = []; for (let i = 0; i < t.length; i++) { const c = t[i] === 'A' ? 'B' : 'A'; try { const r = m.openLink(t.slice(0, i) + c + t.slice(i + 1), 50, d); out.push(r.fileId); } catch (e) { if (e.code !== 'invalid_link') out.push('crash'); } } return out; }, expect: [] },
  { name: 'AC2 [safety] [unprompted] a token signed with another secret is refused', run: async (l) => { const m = await L(l); const t = m.createLink('f', 100, { secret: 'other', store: {} }); return code(() => m.openLink(t, 50, D())); }, expect: refused },
  { name: 'AC2 [safety] [unprompted] nonsense is refused, never a crash', run: async (l) => { const m = await L(l); const d = D(); return ['', '.', '..', 'a.b', 'a.b.c', 'ÿÿÿ.ÿ', null, 5, {}, '%00.%00', Buffer.from('[1]').toString('base64url') + '.x'].map((t) => code(() => m.openLink(t, 1, d))); }, expect: Array(11).fill(refused) },
  { name: 'AC2 [safety] [unprompted] a token cut short is refused', run: async (l) => { const m = await L(l); const d = D(); const t = m.createLink('f', 100, d); return [t.slice(0, -1), t.slice(0, -10), t.slice(0, 5)].map((x) => code(() => m.openLink(x, 1, d))); }, expect: [refused, refused, refused] },
  { name: 'AC3 [functional] revoking stops links made before', run: async (l) => { const m = await L(l); const d = D(); const t = m.createLink('f', 100, d); m.revokeLink('f', d); return code(() => m.openLink(t, 1, d)); }, expect: refused },
  { name: 'AC3 [boundary] revoking leaves other files alone, and a new link works', run: async (l) => { const m = await L(l); const d = D(); const other = m.createLink('g', 100, d); m.revokeLink('f', d); const fresh = m.createLink('f', 100, d); return [code(() => m.openLink(other, 1, d)), code(() => m.openLink(fresh, 1, d))]; }, expect: [null, null] },
  { name: 'AC3 [safety] [unprompted] a revocation survives a restart', run: async (l) => { const d = D(); const m = await L(l); const t = m.createLink('f', 100, d); m.revokeLink('f', d); const fresh = await import(process.env.TASK_WORKSPACE + '/src/links.mjs?restart'); return code(() => fresh.openLink(t, 1, JSON.parse(JSON.stringify(d)))); }, expect: refused },
  { name: 'AC3 [regression] file names are unchanged', run: async (l) => (await l('src/files.mjs')).fileName('a'), expect: 'file-a' },
];
