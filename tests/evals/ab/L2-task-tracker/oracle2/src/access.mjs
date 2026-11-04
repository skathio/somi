// SOMI-CANARY-L2-d5ba01ad929003be
const ROLES = { read: ['owner', 'editor', 'viewer'], write: ['owner', 'editor'] };

export function can(store, userId, action, projectId) {
  const p = store.projects.find((x) => x.id === projectId);
  if (!p) return false;
  const member = store.members.find((m) => m.projectId === projectId && m.userId === userId);
  const role = p.ownerId === userId ? 'owner' : member?.role;
  return (ROLES[action] ?? []).includes(role);
}
