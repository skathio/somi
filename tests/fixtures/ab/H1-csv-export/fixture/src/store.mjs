// In-memory order repository over data/orders.json. Orders are ordered by created_at, then id.
import { readFileSync } from 'node:fs';
import { HttpError } from './http.mjs';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const orders = JSON.parse(readFileSync(new URL('../data/orders.json', import.meta.url), 'utf8')).sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id));
const position = new Map(orders.map((o, i) => [o.id, i]));

// status matches exactly (it is already lower case), from is inclusive, to is exclusive.
function matches(order, filters) {
  return (filters.status === null || order.status === filters.status)
    && (filters.from === null || order.created_at >= filters.from)
    && (filters.to === null || order.created_at < filters.to);
}

// One page of the orders matching `filters`, after the order with id `after` (null: from the start).
export function listOrders(filters, { limit, after }) {
  const start = after === null ? -1 : position.get(after);
  if (start === undefined) throw new HttpError(400, 'invalid_cursor', 'unknown cursor');
  const rest = orders.filter((o) => position.get(o.id) > start && matches(o, filters));
  const items = rest.slice(0, limit);
  return { items, next: rest.length > limit ? items.at(-1).id : null };
}

export function findOrder(id) {
  return orders.find((o) => o.id === id) ?? null;
}
