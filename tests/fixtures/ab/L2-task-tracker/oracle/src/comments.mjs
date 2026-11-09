// SOMI-CANARY-L2-d5ba01ad929003be
import { allowed, iso, page } from './core.mjs';
import { findTask } from './tasks.mjs';

export function addComment(store, userId, taskId, { body }) {
  const t = findTask(store, taskId);
  allowed(store, userId, 'write', t.projectId);
  const c = { id: store.nextId(), taskId, authorId: userId, body, createdAt: iso(store) };
  store.comments.push(c);
  return c;
}
export function listComments(store, userId, taskId, opts = {}) {
  const t = findTask(store, taskId);
  allowed(store, userId, 'read', t.projectId);
  return page(store.comments.filter((c) => c.taskId === taskId), opts);
}
