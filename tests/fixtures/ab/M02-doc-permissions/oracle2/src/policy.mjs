// SOMI-CANARY-M02-62b47d0a708fba91
const RULES = {
  read: ({ owner, share, roles }) => owner || Boolean(share) || roles.has('viewer') || roles.has('editor'),
  update: ({ owner, share, roles, archived }) => !archived && (owner || share === 'edit' || roles.has('editor')),
  delete: ({ owner, roles }) => owner || roles.has('admin'),
  share: ({ owner, roles, archived }) => !archived && (owner || roles.has('admin')),
  archive: ({ owner, roles, archived }) => !archived && (owner || roles.has('admin')),
};

export function can(store, actorId, action, doc) {
  const user = store.users.get(actorId);
  if (user === undefined) return false;
  const roles = new Set(user.roles);
  if (action === 'create') return roles.has('editor') || roles.has('admin');
  const rule = RULES[action];
  if (!rule || !doc || doc.orgId !== user.orgId) return false;
  return rule({ owner: doc.ownerId === actorId, share: (doc.shares && doc.shares[actorId]) || null, roles, archived: doc.archived === true });
}
