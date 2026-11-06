// SOMI-CANARY-N37-45fdb4e7268c8d81
import { inOrg, org } from './lookup.mjs';

export const listProjects = (store, ctx) => store.projects.filter((p) => p.orgId === org(store, ctx));
export const getProject = (store, ctx, id) => inOrg(store, ctx, 'projects', id);
export function renameProject(store, ctx, id, name) {
  const p = inOrg(store, ctx, 'projects', id);
  p.name = name;
  return p;
}
