// SOMI-CANARY-N37-45fdb4e7268c8d81
import { inOrg, taskFor } from './lookup.mjs';

export function labelTask(store, ctx, taskId, labelId) {
  const task = taskFor(store, ctx, taskId);
  inOrg(store, ctx, 'labels', labelId);
  task.labels = [...(task.labels ?? []), labelId];
  return task;
}

export function tasksWithLabel(store, ctx, labelId) {
  inOrg(store, ctx, 'labels', labelId);
  return store.tasks.filter((t) => (t.labels ?? []).includes(labelId));
}
