// SOMI-CANARY-L2-d5ba01ad929003be
import { HttpError } from './errors.mjs';
import { iso, project } from './core.mjs';

const onlyOwner = (p, userId) => { if (p.ownerId !== userId) throw new HttpError(403, 'forbidden', 'only the owner'); };

export function createProject(store, userId, { name }) {
  const p = { id: store.nextId(), name, ownerId: userId, createdAt: iso(store), archived: false };
  store.projects.push(p);
  return p;
}
export function addMember(store, userId, projectId, memberId, role) {
  const p = project(store, projectId);
  onlyOwner(p, userId);
  store.members.push({ projectId, userId: memberId, role });
}
export function archiveProject(store, userId, projectId) {
  const p = project(store, projectId);
  onlyOwner(p, userId);
  p.archived = true;
}
export function restoreProject(store, userId, projectId) {
  const p = store.projects.find((x) => x.id === projectId);
  if (!p) throw new HttpError(404, 'not_found', 'no such thing');
  if (p.ownerId !== userId) throw new HttpError(404, 'not_found', 'no such thing');
  p.archived = false;
}
