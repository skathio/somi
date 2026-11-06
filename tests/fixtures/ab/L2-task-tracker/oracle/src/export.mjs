// SOMI-CANARY-L2-d5ba01ad929003be
import { HttpError } from './errors.mjs';
import { can } from './access.mjs';

export function exportProject(store, userId, projectId) {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project || (project.archived && project.ownerId !== userId)) throw new HttpError(404, 'not_found', 'no such thing');
  if (!can(store, userId, 'read', projectId)) throw new HttpError(403, 'forbidden', 'not allowed');
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  const ids = new Set(tasks.map((t) => t.id));
  return { project, tasks, comments: store.comments.filter((c) => ids.has(c.taskId)) };
}
