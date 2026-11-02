import { clampLimit } from './paging.mjs';

export function listOrders(store, { limit, offset = 0 } = {}) {
  const sorted = [...store.orders].sort((a, b) => b.createdAt - a.createdAt);
  const size = clampLimit(limit);
  return { items: sorted.slice(offset, offset + size), total: sorted.length };
}
