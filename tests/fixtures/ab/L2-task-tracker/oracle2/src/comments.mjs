// SOMI-CANARY-L2-d5ba01ad929003be
import { guard, paged, stamp } from './core.mjs';
import { findTask } from './tasks.mjs';

export function addComment(store, userId, taskId, input) {
  guard(store, userId, 'write', findTask(store, taskId).projectId);
  const c = { id: store.nextId(), taskId, authorId: userId, body: input.body, createdAt: stamp(store) };
  store.comments.push(c);
  return c;
}
export function listComments(store, userId, taskId, options) {
  guard(store, userId, 'read', findTask(store, taskId).projectId);
  return paged(store.comments.filter((c) => c.taskId === taskId), options);
}
