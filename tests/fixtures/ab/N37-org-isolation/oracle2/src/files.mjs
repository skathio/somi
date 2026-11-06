// SOMI-CANARY-N37-45fdb4e7268c8d81
import { byId, task } from './lookup.mjs';

export function getFile(store, ctx, id) {
  const file = byId(store, 'files', id);
  task(store, ctx, file.taskId);
  return file;
}

export function attachFile(store, ctx, taskId, name) {
  task(store, ctx, taskId);
  const file = { id: store.nextId(), taskId, name };
  store.files.push(file);
  return file;
}
