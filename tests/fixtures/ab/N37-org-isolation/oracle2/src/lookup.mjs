// SOMI-CANARY-N37-45fdb4e7268c8d81
import { notFound } from './errors.mjs';

export function byId(store, table, id) {
  const row = store[table].find((r) => r.id === id);
  if (!row) throw notFound();
  return row;
}
const myOrg = (store, ctx) => byId(store, 'users', ctx.userId).orgId;
export const sameOrg = (store, ctx, orgId) => { if (orgId !== myOrg(store, ctx)) throw notFound(); };
export const project = (store, ctx, id) => { const p = byId(store, 'projects', id); sameOrg(store, ctx, p.orgId); return p; };
export const member = (store, ctx, id) => { const u = byId(store, 'users', id); sameOrg(store, ctx, u.orgId); return u; };
export const label = (store, ctx, id) => { const x = byId(store, 'labels', id); sameOrg(store, ctx, x.orgId); return x; };
export const task = (store, ctx, id) => { const t = byId(store, 'tasks', id); project(store, ctx, t.projectId); return t; };
export const myProjectIds = (store, ctx) => new Set(store.projects.filter((p) => p.orgId === myOrg(store, ctx)).map((p) => p.id));
export const myTasks = (store, ctx) => { const ids = myProjectIds(store, ctx); return store.tasks.filter((t) => ids.has(t.projectId)); };
export const myComments = (store, ctx) => { const ids = new Set(myTasks(store, ctx).map((t) => t.id)); return store.comments.filter((c) => ids.has(c.taskId)); };
export const colleagues = (store, ctx) => store.users.filter((u) => u.orgId === myOrg(store, ctx));
