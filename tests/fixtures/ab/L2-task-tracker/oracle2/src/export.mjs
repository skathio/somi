// SOMI-CANARY-L2-d5ba01ad929003be
import { HttpError } from './errors.mjs';
import { can } from './access.mjs';
import { gone } from './core.mjs';

export function exportProject(store, userId, projectId) {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) throw gone();
  if (project.archived && project.ownerId !== userId) throw gone();
  if (!can(store, userId, 'read', projectId)) throw new HttpError(403, 'forbidden', 'no');
  const tasks = store.tasks.filter((t) => t.projectId === projectId);
  return { project, tasks, comments: store.comments.filter((c) => tasks.some((t) => t.id === c.taskId)) };
}
