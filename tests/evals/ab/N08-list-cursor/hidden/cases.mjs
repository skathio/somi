// SOMI-CANARY-N08-e5fc381dff4bf431
const P = (l) => l('src/orders.mjs');
const O = (id, createdAt) => ({ id, createdAt });
const walk = (m, store, limit, during = () => {}) => { const ids = []; let cursor; let guard = 0; do { const r = m.listOrdersPage(store, { limit, cursor }); ids.push(...r.items.map((o) => o.id)); cursor = r.nextCursor; during(guard); guard++; } while (cursor !== null && guard < 50); return ids; };
const sameSecond = () => ({ orders: [O('a', 5), O('b', 5), O('c', 5), O('d', 5), O('e', 5), O('f', 4)] });
const code = (params) => async (l) => { try { (await P(l)).listOrdersPage(sameSecond(), params); return null; } catch (e) { return [e.status, e.code]; } };
export const cases = [
  { name: 'AC1 [functional] a page is newest first, with a cursor to the next', run: async (l) => { const r = (await P(l)).listOrdersPage({ orders: [O('a', 1), O('b', 3), O('c', 2)] }, { limit: 2 }); return { ids: r.items.map((o) => o.id), more: typeof r.nextCursor }; }, expect: { ids: ['b', 'c'], more: 'string' } },
  { name: 'AC2 [functional] the last page has no cursor, even when it is exactly full', run: async (l) => (await P(l)).listOrdersPage({ orders: [O('a', 1), O('b', 2)] }, { limit: 2 }).nextCursor, expect: null },
  { name: 'AC2 [boundary] orders sharing a second are each seen once', run: async (l) => walk(await P(l), sameSecond(), 2).sort(), expect: ['a', 'b', 'c', 'd', 'e', 'f'] },
  { name: 'AC2 [boundary] new orders arriving between pages change nothing that was there', run: async (l) => { const s = sameSecond(); const seen = walk(await P(l), s, 2, (i) => s.orders.push(O('new' + i, 9 + i))); return seen.filter((id) => !id.startsWith('new')).sort(); }, expect: ['a', 'b', 'c', 'd', 'e', 'f'] },
  { name: 'AC2 [boundary] a new order in the same second as the page edge does not repeat others', run: async (l) => { const s = sameSecond(); const seen = walk(await P(l), s, 2, (i) => { if (i === 0) s.orders.push(O('aa', 5)); }); return seen.filter((id) => id !== 'aa').length === new Set(seen.filter((id) => id !== 'aa')).size && seen.filter((id) => id !== 'aa').length; }, expect: 6 },
  { name: 'AC3 [boundary] a limit of zero is a bad parameter', run: code({ limit: 0 }), expect: [400, 'invalid_query'] },
  { name: 'AC3 [boundary] a limit over the maximum is a bad parameter', run: code({ limit: 101 }), expect: [400, 'invalid_query'] },
  { name: 'AC3 [boundary] a limit that is not a whole number is a bad parameter', run: code({ limit: 1.5 }), expect: [400, 'invalid_query'] },
  { name: 'AC3 [functional] the limit defaults to 20', run: async (l) => (await P(l)).listOrdersPage({ orders: Array.from({ length: 25 }, (_, i) => O('o' + i, i)) }, {}).items.length, expect: 20 },
  { name: 'AC3 [safety] a made-up cursor is refused', run: code({ cursor: 'not-a-cursor' }), expect: [400, 'invalid_cursor'] },
  { name: 'AC3 [safety] a well-formed cursor of the wrong shape is refused', run: code({ cursor: Buffer.from('{"x":1}').toString('base64url') }), expect: [400, 'invalid_cursor'] },
  { name: 'AC3 [safety] an empty cursor is refused', run: code({ cursor: '' }), expect: [400, 'invalid_cursor'] },
  { name: 'AC3 [regression] offset paging keeps working', run: async (l) => (await P(l)).listOrders({ orders: [O('a', 1), O('b', 2)] }, { limit: 1 }).items[0].id, expect: 'b' },
];
