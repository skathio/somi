// SOMI-CANARY-L2-d5ba01ad929003be
import { HttpError } from './errors.mjs';
import { can } from './access.mjs';

const visible = (store, p) => !p.archived;
export const iso = (store) => new Date(store.clock()).toISOString();
export const notFound = () => new HttpError(404, 'not_found', 'no such thing');
export function project(store, id) {
  const p = store.projects.find((x) => x.id === id);
  if (!p || !visible(store, p)) throw notFound();
  return p;
}
export function allowed(store, userId, action, projectId) {
  project(store, projectId);
  if (!can(store, userId, action, projectId)) throw new HttpError(403, 'forbidden', 'not allowed');
}
export function page(list, { limit = 20, cursor } = {}) {
  const start = cursor === undefined || cursor === null ? 0 : Number(cursor);
  const rest = list.slice(start);
  return { items: rest.slice(0, limit), nextCursor: rest.length > limit ? String(start + limit) : null };
}
export const liveProjects = (store) => store.projects.filter((p) => visible(store, p));
