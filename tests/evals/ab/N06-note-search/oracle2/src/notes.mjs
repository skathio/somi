// SOMI-CANARY-N06-b8d05f258c6d1e16
import { HttpError } from './errors.mjs';
import { matcher } from './search.mjs';

export function listNotes(store, user, params = {}) {
  const { limit = 20, offset = 0, q } = params;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_query', 'limit runs from 1 to 100');
  const matches = matcher(q);
  const sorted = store.notes.filter((n) => n.owner === user && !n.deletedAt && matches(n)).sort((a, b) => b.createdAt - a.createdAt);
  const items = sorted.slice(offset, offset + limit);
  return { items, total: sorted.length, nextOffset: offset + limit < sorted.length ? offset + limit : null };
}
