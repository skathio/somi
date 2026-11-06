// SOMI-CANARY-L2-d5ba01ad929003be
import { HttpError } from './errors.mjs';
import { gone, openProject, stamp } from './core.mjs';

export function createProject(store, userId, input) {
  const project = { id: store.nextId(), name: input.name, ownerId: userId, createdAt: stamp(store) };
  store.projects.push(project);
  return project;
}
function owned(store, userId, id) {
  const p = openProject(store, id);
  if (p.ownerId !== userId) throw new HttpError(403, 'forbidden', 'owner only');
  return p;
}
export function addMember(store, userId, projectId, memberId, role) {
  owned(store, userId, projectId);
  store.members.push({ projectId, userId: memberId, role });
}
export function archiveProject(store, userId, projectId) { owned(store, userId, projectId).archived = true; }
export function restoreProject(store, userId, projectId) {
  const p = store.projects.find((x) => x.id === projectId && x.ownerId === userId);
  if (!p) throw gone();
  delete p.archived;
}
