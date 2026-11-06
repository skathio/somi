// SOMI-CANARY-N37-45fdb4e7268c8d81
import { member, project, task } from './lookup.mjs';

export const getTask = task;

export function createTask(store, ctx, input) {
  const { projectId, title, assigneeId = null } = input;
  project(store, ctx, projectId);
  if (assigneeId) member(store, ctx, assigneeId);
  const row = { id: store.nextId(), projectId, title, assigneeId };
  store.tasks.push(row);
  return row;
}

export function updateTask(store, ctx, id, changes) {
  const row = task(store, ctx, id);
  if ('projectId' in changes) project(store, ctx, changes.projectId);
  if (changes.assigneeId) member(store, ctx, changes.assigneeId);
  Object.assign(row, changes);
  return row;
}

export function deleteTasks(store, ctx, ids) {
  ids.forEach((id) => task(store, ctx, id));
  const gone = new Set(ids);
  store.tasks = store.tasks.filter((t) => !gone.has(t.id));
  return gone.size;
}

export function copyTask(store, ctx, id, { projectId }) {
  const source = task(store, ctx, id);
  project(store, ctx, projectId);
  const row = { ...source, id: store.nextId(), projectId };
  store.tasks.push(row);
  return row;
}
