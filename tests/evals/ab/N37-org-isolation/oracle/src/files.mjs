// SOMI-CANARY-N37-45fdb4e7268c8d81
import { inOrg, taskFor } from './lookup.mjs';

export const getFile = (store, ctx, id) => inOrg(store, ctx, 'files', id);

export function attachFile(store, ctx, taskId, name) {
  taskFor(store, ctx, taskId);
  const file = { id: store.nextId(), taskId, name };
  store.files.push(file);
  return file;
}
