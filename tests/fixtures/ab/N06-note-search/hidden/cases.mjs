// SOMI-CANARY-N06-b8d05f258c6d1e16
const N = (id, title, body, tags, createdAt, extra = {}) => ({ id, owner: 'me', title, body, tags, createdAt, ...extra });
const store = () => ({ notes: [
  N(1, 'Café plans', 'meet at noon', ['Travel'], 10),
  N(2, 'Budget', 'the cafe costs too much', [], 20),
  N(3, 'Groceries', 'milk, eggs', ['café'], 30),
  N(4, 'C++ tips', 'use (auto) wisely', [], 40),
  N(5, 'Deleted cafe', 'gone', [], 50, { deletedAt: 1 }),
  { ...N(6, 'Not mine cafe', 'x', [], 60), owner: 'other' },
  N(7, 'Plans for noon', 'nothing here', [], 70),
] });
const list = (params) => async (l) => { const r = (await l('src/notes.mjs')).listNotes(store(), 'me', params); return { ids: r.items.map((n) => n.id), total: r.total, next: r.nextOffset }; };
const code = (params) => async (l) => { try { (await l('src/notes.mjs')).listNotes(store(), 'me', params); return null; } catch (e) { return e.code ?? e.name; } };
export const cases = [
  { name: 'AC2 [functional] accents and case do not matter, newest first, in every field', run: list({ q: 'CAFE' }), expect: { ids: [3, 2, 1], total: 3, next: null } },
  { name: 'AC2 [functional] the query is normalized too', run: list({ q: 'budgét' }), expect: { ids: [2], total: 1, next: null } },
  { name: 'AC2 [functional] tags are searched', run: list({ q: 'travel' }), expect: { ids: [1], total: 1, next: null } },
  { name: 'AC2 [functional] every word has to match, in any order, across fields', run: list({ q: 'noon plans' }), expect: { ids: [7, 1], total: 2, next: null } },
  { name: 'AC2 [boundary] one matching word is not enough', run: list({ q: 'budget noon' }), expect: { ids: [], total: 0, next: null } },
  { name: 'AC2 [boundary] search text is literal', run: list({ q: 'c++ (auto)' }), expect: { ids: [4], total: 1, next: null } },
  { name: 'AC2 [boundary] a wildcard character matches nothing special', run: list({ q: '.*' }), expect: { ids: [], total: 0, next: null } },
  { name: 'AC2 [functional] paging and total apply to the matches', run: list({ q: 'cafe', limit: 2 }), expect: { ids: [3, 2], total: 3, next: 2 } },
  { name: 'AC2 [boundary] over the length limit is a bad parameter', run: code({ q: 'x'.repeat(201) }), expect: 'invalid_query' },
  { name: 'AC2 [regression] exactly at the limit is fine', run: list({ limit: 1 }), expect: { ids: [7], total: 5, next: 1 } },
  { name: 'AC2 [regression] blank search text is no search', run: list({ q: '   ', limit: 1 }), expect: { ids: [7], total: 5, next: 1 } },
  { name: 'AC2 [boundary] search text that is not text is a bad parameter', run: code({ q: 5 }), expect: 'invalid_query' },
  { name: 'AC3 [regression] no search lists everything of mine', run: list({}), expect: { ids: [7, 4, 3, 2, 1], total: 5, next: null } },
];
