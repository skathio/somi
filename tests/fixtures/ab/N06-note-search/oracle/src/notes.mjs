// SOMI-CANARY-N06-b8d05f258c6d1e16
import { HttpError } from './errors.mjs';
import { normalize } from './text.mjs';

export function listNotes(store, user, { limit = 20, offset = 0, q } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_query', 'limit runs from 1 to 100');
  let visible = store.notes.filter((n) => n.owner === user && !n.deletedAt);
  if (q !== undefined && q !== null) {
    if (typeof q !== 'string') throw new HttpError(400, 'invalid_query', 'q must be text');
    if (q.length > 200) throw new HttpError(400, 'invalid_query', 'q is too long');
    const words = normalize(q).split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      visible = visible.filter((n) => {
        const hay = normalize([n.title, n.body, ...(n.tags ?? [])].join('\n'));
        return words.every((w) => hay.includes(w));
      });
    }
  }
  const sorted = [...visible].sort((a, b) => b.createdAt - a.createdAt);
  const items = sorted.slice(offset, offset + limit);
  return { items, total: sorted.length, nextOffset: offset + limit < sorted.length ? offset + limit : null };
}
