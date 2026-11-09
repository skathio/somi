// SOMI-CANARY-L2-d5ba01ad929003be
import { can } from './access.mjs';
import { paged } from './core.mjs';

export function search(store, userId, query, options) {
  const needle = String(query).toLowerCase();
  const hits = store.tasks.filter((t) => {
    const p = store.projects.find((x) => x.id === t.projectId);
    return p && !p.archived && can(store, userId, 'read', p.id) && t.title.toLowerCase().includes(needle);
  });
  return paged(hits, options);
}
