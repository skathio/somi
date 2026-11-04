// SOMI-CANARY-N37-45fdb4e7268c8d81
import { notFound } from './errors.mjs';

export function byId(store, table, id) {
  const row = store[table].find((r) => r.id === id);
  if (!row) throw notFound();
  return row;
}

export const org = (store, ctx) => byId(store, 'users', ctx.userId).orgId;

function orgOfRow(store, table, row) {
  if (table === 'projects' || table === 'users' || table === 'labels') return row.orgId;
  if (table === 'tasks') return byId(store, 'projects', row.projectId).orgId;
  return orgOfRow(store, 'tasks', byId(store, 'tasks', row.taskId));
}

export function inOrg(store, ctx, table, id) {
  const row = byId(store, table, id);
  if (orgOfRow(store, table, row) !== org(store, ctx)) throw notFound();
  return row;
}

export const taskFor = (store, ctx, id) => inOrg(store, ctx, 'tasks', id);
export const orgTasks = (store, ctx) => store.tasks.filter((t) => orgOfRow(store, 'tasks', t) === org(store, ctx));
export const orgComments = (store, ctx) => store.comments.filter((c) => orgOfRow(store, 'comments', c) === org(store, ctx));
