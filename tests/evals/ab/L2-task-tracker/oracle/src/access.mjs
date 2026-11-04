// SOMI-CANARY-L2-d5ba01ad929003be
export function can(store, userId, action, projectId) {
  const p = store.projects.find((x) => x.id === projectId);
  if (!p) return false;
  const role = p.ownerId === userId ? 'owner' : store.members.find((m) => m.projectId === projectId && m.userId === userId)?.role;
  if (action === 'read') return Boolean(role);
  if (action === 'write') return role === 'owner' || role === 'editor';
  return false;
}
