// SOMI-CANARY-N37-45fdb4e7268c8d81
import { byId, colleagues, task } from './lookup.mjs';

export function addComment(store, ctx, taskId, body) {
  task(store, ctx, taskId);
  const comment = { id: store.nextId(), taskId, authorId: ctx.userId, body };
  store.comments.push(comment);
  const people = colleagues(store, ctx);
  for (const m of body.matchAll(/@(\w+)/g)) {
    const hit = people.find((u) => u.name === m[1]);
    if (hit) store.notifications.push({ userId: hit.id, commentId: comment.id });
  }
  return comment;
}

export function listComments(store, ctx, taskId) {
  task(store, ctx, taskId);
  return store.comments.filter((c) => c.taskId === taskId);
}

export function deleteComment(store, ctx, id) {
  task(store, ctx, byId(store, 'comments', id).taskId);
  store.comments = store.comments.filter((c) => c.id !== id);
}
