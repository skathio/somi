// SOMI-CANARY-L2-d5ba01ad929003be
import { allowed, iso, notFound, page } from './core.mjs';

export function createTask(store, userId, projectId, { title }) {
  allowed(store, userId, 'write', projectId);
  const t = { id: store.nextId(), projectId, title, status: 'open', createdAt: iso(store), updatedAt: iso(store) };
  store.tasks.push(t);
  return t;
}
export function findTask(store, taskId) {
  const t = store.tasks.find((x) => x.id === taskId);
  if (!t) throw notFound();
  return t;
}
export function getTask(store, userId, taskId) {
  const t = findTask(store, taskId);
  allowed(store, userId, 'read', t.projectId);
  return t;
}
export function updateTask(store, userId, taskId, changes) {
  const t = findTask(store, taskId);
  allowed(store, userId, 'write', t.projectId);
  Object.assign(t, changes, { updatedAt: iso(store) });
  return t;
}
export function listTasks(store, userId, projectId, { limit, cursor, status } = {}) {
  allowed(store, userId, 'read', projectId);
  return page(store.tasks.filter((t) => t.projectId === projectId && (!status || t.status === status)), { limit, cursor });
}
