// SOMI-CANARY-N37-45fdb4e7268c8d81
import { label, task } from './lookup.mjs';

export function labelTask(store, ctx, taskId, labelId) {
  const row = task(store, ctx, taskId);
  label(store, ctx, labelId);
  row.labels = [...(row.labels ?? []), labelId];
  return row;
}

export function tasksWithLabel(store, ctx, labelId) {
  label(store, ctx, labelId);
  return store.tasks.filter((t) => (t.labels ?? []).includes(labelId));
}
