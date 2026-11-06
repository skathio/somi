// SOMI-CANARY-N08-e5fc381dff4bf431
import { clampLimit } from './paging.mjs';
import { HttpError } from './errors.mjs';

export function listOrders(store, { limit, offset = 0 } = {}) {
  const sorted = [...store.orders].sort((a, b) => b.createdAt - a.createdAt);
  const size = clampLimit(limit);
  return { items: sorted.slice(offset, offset + size), total: sorted.length };
}

const TAG = 'v1.';
const compare = (x, y) => (x[0] !== y[0] ? y[0] - x[0] : y[1] < x[1] ? -1 : y[1] > x[1] ? 1 : 0);
const position = (o) => [o.createdAt, o.id];

function decode(cursor) {
  const bad = () => new HttpError(400, 'invalid_cursor', 'that cursor is not ours');
  if (typeof cursor !== 'string' || !cursor.startsWith(TAG)) throw bad();
  const text = Buffer.from(cursor.slice(TAG.length), 'hex').toString();
  const cut = text.indexOf(':');
  const at = Number(text.slice(0, cut));
  if (cut < 1 || !Number.isInteger(at) || cut === text.length - 1) throw bad();
  return [at, text.slice(cut + 1)];
}

export function listOrdersPage(store, options = {}) {
  const { limit = 20, cursor = null } = options;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_query', 'bad limit');
  const from = cursor === null ? null : decode(cursor);
  const ordered = store.orders.map((o) => o).sort((a, b) => compare(position(a), position(b)));
  const rest = from ? ordered.filter((o) => compare(position(o), from) > 0) : ordered;
  const items = rest.slice(0, limit);
  const end = items[items.length - 1];
  return { items, nextCursor: rest.length > limit ? TAG + Buffer.from(end.createdAt + ':' + end.id).toString('hex') : null };
}
