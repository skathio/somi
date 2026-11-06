// SOMI-CANARY-L2-d5ba01ad929003be
import { can } from './access.mjs';
import { liveProjects, page } from './core.mjs';

export function search(store, userId, query, opts = {}) {
  const q = String(query).toLowerCase();
  const ok = new Set(liveProjects(store).filter((p) => can(store, userId, 'read', p.id)).map((p) => p.id));
  return page(store.tasks.filter((t) => ok.has(t.projectId) && t.title.toLowerCase().includes(q)), opts);
}
