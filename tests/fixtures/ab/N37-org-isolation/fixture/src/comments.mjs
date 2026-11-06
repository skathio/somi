import { byId } from './lookup.mjs';

function notifyMentions(store, comment) {
  for (const [, name] of comment.body.matchAll(/@(\w+)/g)) {
    const user = store.users.find((u) => u.name === name);
    if (user) store.notifications.push({ userId: user.id, commentId: comment.id });
  }
}

export function addComment(store, ctx, taskId, body) {
  byId(store, 'tasks', taskId);
  const comment = { id: store.nextId(), taskId, authorId: ctx.userId, body };
  store.comments.push(comment);
  notifyMentions(store, comment);
  return comment;
}

export function listComments(store, ctx, taskId) {
  byId(store, 'tasks', taskId);
  return store.comments.filter((c) => c.taskId === taskId);
}

export function deleteComment(store, ctx, id) {
  byId(store, 'comments', id);
  store.comments = store.comments.filter((c) => c.id !== id);
}
