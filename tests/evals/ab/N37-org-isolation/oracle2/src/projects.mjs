// SOMI-CANARY-N37-45fdb4e7268c8d81
import { byId, project, sameOrg } from './lookup.mjs';

export function listProjects(store, ctx) {
  const me = byId(store, 'users', ctx.userId);
  return store.projects.filter((p) => p.orgId === me.orgId);
}
export const getProject = (store, ctx, id) => project(store, ctx, id);
export function renameProject(store, ctx, id, name) {
  return Object.assign(project(store, ctx, id), { name });
}
