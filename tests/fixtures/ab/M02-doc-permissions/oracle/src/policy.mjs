// SOMI-CANARY-M02-62b47d0a708fba91
const has = (user, ...roles) => roles.some((r) => user.roles.includes(r));
const sharedAs = (doc, user) => doc.shares?.[user.id] ?? null;

// The one place that decides. Admins manage documents but do not read or change other people's documents unless shared with them.
export function can(store, actorId, action, doc) {
  const user = store.users.get(actorId);
  if (!user) return false;
  if (action === 'create') return has(user, 'editor', 'admin');
  if (!doc || doc.orgId !== user.orgId) return false;
  const owner = doc.ownerId === user.id;
  const share = sharedAs(doc, user);
  switch (action) {
    case 'read': return owner || share !== null || has(user, 'viewer', 'editor');
    case 'update': return !doc.archived && (owner || share === 'edit' || has(user, 'editor'));
    case 'delete': return owner || has(user, 'admin');
    case 'share':
    case 'archive': return !doc.archived && (owner || has(user, 'admin'));
    default: return false;
  }
}
