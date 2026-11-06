// SOMI-CANARY-N08-e5fc381dff4bf431
import { clampLimit } from './paging.mjs';
import { HttpError } from './errors.mjs';

export function listOrders(store, { limit, offset = 0 } = {}) {
  const sorted = [...store.orders].sort((a, b) => b.createdAt - a.createdAt);
  const size = clampLimit(limit);
  return { items: sorted.slice(offset, offset + size), total: sorted.length };
}

const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);
const after = (o, c) => o.createdAt < c.at || (o.createdAt === c.at && o.id < c.id);

function readCursor(cursor) {
  if (typeof cursor !== 'string') throw new HttpError(400, 'invalid_cursor', 'bad cursor');
  let parsed;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'invalid_cursor', 'bad cursor'); }
  if (!parsed || typeof parsed !== 'object') throw new HttpError(400, 'invalid_cursor', 'bad cursor');
  if (!Number.isFinite(parsed.at) || typeof parsed.id !== 'string') throw new HttpError(400, 'invalid_cursor', 'bad cursor');
  return parsed;
}

export function listOrdersPage(store, { limit = 20, cursor } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_query', 'limit runs from 1 to 100');
  const sorted = [...store.orders].sort(newestFirst);
  const start = cursor === undefined || cursor === null ? null : readCursor(cursor);
  const rest = start ? sorted.filter((o) => after(o, start)) : sorted;
  const more = rest.length > limit;
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: more ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString('base64url') : null };
}
