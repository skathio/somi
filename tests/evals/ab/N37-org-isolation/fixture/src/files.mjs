import { byId } from './lookup.mjs';

export const getFile = (store, ctx, id) => byId(store, 'files', id);

export function attachFile(store, ctx, taskId, name) {
  byId(store, 'tasks', taskId);
  const file = { id: store.nextId(), taskId, name };
  store.files.push(file);
  return file;
}
