// SOMI-CANARY-N37-45fdb4e7268c8d81
import { inOrg, org, taskFor } from './lookup.mjs';

function notifyMentions(store, ctx, comment) {
  for (const [, name] of comment.body.matchAll(/@(\w+)/g)) {
    const user = store.users.find((u) => u.name === name && u.orgId === org(store, ctx));
    if (user) store.notifications.push({ userId: user.id, commentId: comment.id });
  }
}

export function addComment(store, ctx, taskId, body) {
  taskFor(store, ctx, taskId);
  const comment = { id: store.nextId(), taskId, authorId: ctx.userId, body };
  store.comments.push(comment);
  notifyMentions(store, ctx, comment);
  return comment;
}

export function listComments(store, ctx, taskId) {
  taskFor(store, ctx, taskId);
  return store.comments.filter((c) => c.taskId === taskId);
}

export function deleteComment(store, ctx, id) {
  inOrg(store, ctx, 'comments', id);
  store.comments = store.comments.filter((c) => c.id !== id);
}
