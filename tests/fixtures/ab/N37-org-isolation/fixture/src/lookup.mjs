import { notFound } from './errors.mjs';

export function byId(store, table, id) {
  const row = store[table].find((r) => r.id === id);
  if (!row) throw notFound();
  return row;
}
