import { byId } from './lookup.mjs';

export function labelTask(store, ctx, taskId, labelId) {
  const task = byId(store, 'tasks', taskId);
  byId(store, 'labels', labelId);
  task.labels = [...(task.labels ?? []), labelId];
  return task;
}

export const tasksWithLabel = (store, ctx, labelId) => store.tasks.filter((t) => (t.labels ?? []).includes(labelId));
