import { byId } from './lookup.mjs';

export const getTask = (store, ctx, id) => byId(store, 'tasks', id);

export function createTask(store, ctx, { projectId, title, assigneeId = null }) {
  byId(store, 'projects', projectId);
  if (assigneeId) byId(store, 'users', assigneeId);
  const task = { id: store.nextId(), projectId, title, assigneeId };
  store.tasks.push(task);
  return task;
}

export function updateTask(store, ctx, id, changes) {
  const task = byId(store, 'tasks', id);
  if (changes.projectId !== undefined) byId(store, 'projects', changes.projectId);
  if (changes.assigneeId) byId(store, 'users', changes.assigneeId);
  return Object.assign(task, changes);
}

export function deleteTasks(store, ctx, ids) {
  const found = ids.map((id) => byId(store, 'tasks', id));
  store.tasks = store.tasks.filter((t) => !found.includes(t));
  return found.length;
}

export function copyTask(store, ctx, id, { projectId }) {
  const from = byId(store, 'tasks', id);
  byId(store, 'projects', projectId);
  const task = { ...from, id: store.nextId(), projectId };
  store.tasks.push(task);
  return task;
}
