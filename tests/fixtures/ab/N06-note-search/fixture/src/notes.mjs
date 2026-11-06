import { HttpError } from './errors.mjs';

export function listNotes(store, user, { limit = 20, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_query', 'limit runs from 1 to 100');
  const visible = store.notes.filter((n) => n.owner === user && !n.deletedAt);
  const sorted = [...visible].sort((a, b) => b.createdAt - a.createdAt);
  const items = sorted.slice(offset, offset + limit);
  return { items, total: sorted.length, nextOffset: offset + limit < sorted.length ? offset + limit : null };
}
