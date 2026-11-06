// SOMI-CANARY-L2-d5ba01ad929003be
import { gone, guard, paged, stamp } from './core.mjs';

const task = (store, id) => { const t = store.tasks.find((x) => x.id === id); if (!t) throw gone(); return t; };
export { task as findTask };
export function createTask(store, userId, projectId, input) {
  guard(store, userId, 'write', projectId);
  const now = stamp(store);
  const t = { id: store.nextId(), projectId, title: input.title, status: 'open', createdAt: now, updatedAt: now };
  store.tasks.push(t);
  return t;
}
export function getTask(store, userId, id) { const t = task(store, id); guard(store, userId, 'read', t.projectId); return t; }
export function updateTask(store, userId, id, changes) {
  const t = task(store, id);
  guard(store, userId, 'write', t.projectId);
  return Object.assign(t, changes, { updatedAt: stamp(store) });
}
export function listTasks(store, userId, projectId, options = {}) {
  guard(store, userId, 'read', projectId);
  const list = store.tasks.filter((t) => t.projectId === projectId).filter((t) => !options.status || options.status === t.status);
  return paged(list, options);
}
