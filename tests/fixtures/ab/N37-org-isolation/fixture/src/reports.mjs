import { byId } from './lookup.mjs';

export function projectStats(store, ctx, projectId) {
  byId(store, 'projects', projectId);
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  return { tasks: tasks.length, unassigned: tasks.filter((t) => !t.assigneeId).length };
}

export function userActivity(store, ctx, userId) {
  byId(store, 'users', userId);
  return { assigned: store.tasks.filter((t) => t.assigneeId === userId).length, comments: store.comments.filter((c) => c.authorId === userId).length };
}

export function recentComments(store, ctx, limit = 10) {
  return store.comments.slice(-limit);
}
