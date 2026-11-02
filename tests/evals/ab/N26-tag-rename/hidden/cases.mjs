// SOMI-CANARY-N26-a15d4b93f79b34e6
async function w(l) {
  const m = await l('src/tags.mjs');
  const store = { notes: [{ id: 1, owner: 'me', tags: [] }, { id: 2, owner: 'me', tags: [] }, { id: 3, owner: 'me', tags: [] }, { id: 4, owner: 'you', tags: [] }], tagCounts: {} };
  const put = (i, ...names) => names.forEach((n) => m.addTag(store, store.notes[i], n));
  put(0, 'red', 'blue'); put(1, 'red'); put(2, 'blue', 'green'); put(3, 'red');
  return { ...m, store, tags: () => store.notes.map((n) => n.tags), counts: (u = 'me') => store.tagCounts[u] };
}
const code = (f) => { try { f(); return null; } catch (e) { return [e.status, e.code]; } };
export const cases = [
  { name: 'AC1 [functional] it renames across my notes and counts the notes changed', run: async (l) => { const x = await w(l); const n = x.renameTag(x.store, 'me', 'green', 'teal'); return [n, x.tags()[2]]; }, expect: [1, ['blue', 'teal']] },
  { name: 'AC2 [functional] the sidebar counts follow', run: async (l) => { const x = await w(l); x.renameTag(x.store, 'me', 'green', 'teal'); return x.counts(); }, expect: { red: 2, blue: 2, teal: 1 } },
  { name: 'AC2 [boundary] a merge leaves one tag on the note and keeps its place', run: async (l) => { const x = await w(l); const n = x.renameTag(x.store, 'me', 'red', 'blue'); return [n, x.tags().slice(0, 3)]; }, expect: [2, [['blue'], ['blue'], ['blue', 'green']]] },
  { name: 'AC2 [boundary] a merge counts each note once', run: async (l) => { const x = await w(l); x.renameTag(x.store, 'me', 'red', 'blue'); return x.counts(); }, expect: { blue: 3, green: 1 } },
  { name: 'AC2 [boundary] the old tag leaves no zero behind', run: async (l) => { const x = await w(l); x.renameTag(x.store, 'me', 'green', 'teal'); return 'green' in x.counts(); }, expect: false },
  { name: 'AC1 [safety] other people keep their tags and counts', run: async (l) => { const x = await w(l); x.renameTag(x.store, 'me', 'red', 'crimson'); return [x.tags()[3], x.counts('you'), x.tags()[0][0]]; }, expect: [['red'], { red: 1 }, 'crimson'] },
  { name: 'AC2 [boundary] names are normalized on both sides', run: async (l) => { const x = await w(l); const n = x.renameTag(x.store, 'me', '  GREEN ', 'Sea   Green'); return [n, x.tags()[2], x.counts()['sea-green']]; }, expect: [1, ['blue', 'sea-green'], 1] },
  { name: 'AC2 [boundary] renaming to the same tag changes nothing', run: async (l) => { const x = await w(l); const n = x.renameTag(x.store, 'me', 'Red', ' red '); return [n, x.counts()]; }, expect: [0, { red: 2, blue: 2, green: 1 }] },
  { name: 'AC3 [functional] a tag I do not have is not found, even if someone else has it', run: async (l) => { const x = await w(l); x.addTag(x.store, x.store.notes[3], 'only-you'); return code(() => x.renameTag(x.store, 'me', 'only-you', 'x')); }, expect: [404, 'tag_not_found'] },
  { name: 'AC3 [boundary] a name that normalizes to nothing is refused and nothing changes', run: async (l) => { const x = await w(l); return [code(() => x.renameTag(x.store, 'me', 'red', '   ')), x.counts().red]; }, expect: [[400, 'invalid_tag'], 2] },
  { name: 'AC2 [boundary] adding a tag a note has keeps the rules', run: async (l) => { const x = await w(l); x.addTag(x.store, x.store.notes[0], 'RED'); return [x.tags()[0], x.counts().red]; }, expect: [['red', 'blue'], 2] },
  { name: 'AC2 [regression] the key rule is unchanged', run: async (l) => (await l('src/tags.mjs')).tagKey(' A  b '), expect: 'a-b' },
];
