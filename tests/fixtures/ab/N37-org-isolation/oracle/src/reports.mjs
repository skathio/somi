// SOMI-CANARY-N37-45fdb4e7268c8d81
import { inOrg, orgComments, orgTasks } from './lookup.mjs';

export function projectStats(store, ctx, projectId) {
  inOrg(store, ctx, 'projects', projectId);
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  return { tasks: tasks.length, unassigned: tasks.filter((t) => !t.assigneeId).length };
}

export function userActivity(store, ctx, userId) {
  inOrg(store, ctx, 'users', userId);
  return { assigned: orgTasks(store, ctx).filter((t) => t.assigneeId === userId).length, comments: orgComments(store, ctx).filter((c) => c.authorId === userId).length };
}

export function recentComments(store, ctx, limit = 10) {
  return orgComments(store, ctx).slice(-limit);
}
