// SOMI-CANARY-L2-d5ba01ad929003be
import { HttpError } from './errors.mjs';
import { can } from './access.mjs';

export const stamp = (store) => new Date(store.clock()).toISOString();
export const gone = () => new HttpError(404, 'not_found', 'gone');
export const openProject = (store, id) => { const p = store.projects.find((x) => x.id === id && !x.archived); if (!p) throw gone(); return p; };
export function guard(store, user, action, id) {
  openProject(store, id);
  if (!can(store, user, action, id)) throw new HttpError(403, 'forbidden', 'no');
}
export function paged(all, options) {
  const limit = options?.limit ?? 20;
  const at = options?.cursor ? parseInt(options.cursor, 10) : 0;
  const items = all.slice(at, at + limit);
  return { items, nextCursor: at + limit < all.length ? `${at + limit}` : null };
}
