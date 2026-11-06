import { byId } from './lookup.mjs';

const orgOf = (store, ctx) => byId(store, 'users', ctx.userId).orgId;

export const listProjects = (store, ctx) => store.projects.filter((p) => p.orgId === orgOf(store, ctx));
export const getProject = (store, ctx, id) => byId(store, 'projects', id);
export function renameProject(store, ctx, id, name) {
  const p = byId(store, 'projects', id);
  p.name = name;
  return p;
}
