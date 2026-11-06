// SOMI-CANARY-N37-45fdb4e7268c8d81
import { inOrg, taskFor } from './lookup.mjs';

export const getTask = (store, ctx, id) => taskFor(store, ctx, id);

export function createTask(store, ctx, { projectId, title, assigneeId = null }) {
  inOrg(store, ctx, 'projects', projectId);
  if (assigneeId) inOrg(store, ctx, 'users', assigneeId);
  const task = { id: store.nextId(), projectId, title, assigneeId };
  store.tasks.push(task);
  return task;
}

export function updateTask(store, ctx, id, changes) {
  const task = taskFor(store, ctx, id);
  if (changes.projectId !== undefined) inOrg(store, ctx, 'projects', changes.projectId);
  if (changes.assigneeId) inOrg(store, ctx, 'users', changes.assigneeId);
  return Object.assign(task, changes);
}

export function deleteTasks(store, ctx, ids) {
  const found = ids.map((id) => taskFor(store, ctx, id));
  store.tasks = store.tasks.filter((t) => !found.includes(t));
  return found.length;
}

export function copyTask(store, ctx, id, { projectId }) {
  const from = taskFor(store, ctx, id);
  inOrg(store, ctx, 'projects', projectId);
  const task = { ...from, id: store.nextId(), projectId };
  store.tasks.push(task);
  return task;
}
