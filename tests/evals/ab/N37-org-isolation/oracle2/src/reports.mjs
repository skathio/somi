// SOMI-CANARY-N37-45fdb4e7268c8d81
import { member, myComments, myTasks, project } from './lookup.mjs';

export function projectStats(store, ctx, projectId) {
  project(store, ctx, projectId);
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  return { tasks: tasks.length, unassigned: tasks.filter((t) => !t.assigneeId).length };
}

export function userActivity(store, ctx, userId) {
  member(store, ctx, userId);
  return { assigned: myTasks(store, ctx).filter((t) => t.assigneeId === userId).length, comments: myComments(store, ctx).filter((c) => c.authorId === userId).length };
}

export function recentComments(store, ctx, limit = 10) {
  return myComments(store, ctx).slice(-limit);
}
