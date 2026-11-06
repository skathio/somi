// SOMI-CANARY-M02-62b47d0a708fba91
import { can } from './policy.mjs';
import { fail, ok } from './result.mjs';

const view = (d) => ({ id: d.id, orgId: d.orgId, ownerId: d.ownerId, title: d.title, body: d.body, archived: d.archived });
const deny = (store, action, by, id) => store.denials.push({ action, by, id, at: store.clock() });

// A document in another organisation looks the same as one that does not exist.
function access(store, actorId, id, action) {
  const doc = store.docs.get(id);
  if (!doc) return { error: fail('not_found') };
  const user = store.users.get(actorId);
  if (user && user.orgId !== doc.orgId) { deny(store, action, actorId, id); return { error: fail('not_found') }; }
  if (!can(store, actorId, action, doc)) { deny(store, action, actorId, id); return { error: fail('forbidden') }; }
  return { doc };
}

export function createDoc(store, actorId, { title, body } = {}) {
  if (!can(store, actorId, 'create')) { deny(store, 'create', actorId, null); return fail('forbidden'); }
  if (typeof title !== 'string' || title === '' || typeof body !== 'string') return fail('invalid');
  const user = store.users.get(actorId);
  const doc = { id: store.nextId('doc'), orgId: user.orgId, ownerId: user.id, title, body, archived: false, shares: {} };
  store.docs.set(doc.id, doc);
  return ok(view(doc));
}

export function readDoc(store, actorId, id) {
  const { doc, error } = access(store, actorId, id, 'read');
  return error ?? ok(view(doc));
}

export function updateDoc(store, actorId, id, { title, body } = {}) {
  const { doc, error } = access(store, actorId, id, 'update');
  if (error) return error;
  if (title !== undefined) doc.title = title;
  if (body !== undefined) doc.body = body;
  return ok(view(doc));
}

export function deleteDoc(store, actorId, id) {
  const { error } = access(store, actorId, id, 'delete');
  if (error) return error;
  store.docs.delete(id);
  return ok({ deleted: id });
}

export function shareDoc(store, actorId, id, { userId, access: level } = {}) {
  const { doc, error } = access(store, actorId, id, 'share');
  if (error) return error;
  const target = store.users.get(userId);
  if (!target || target.orgId !== doc.orgId || !['read', 'edit'].includes(level)) return fail('invalid');
  doc.shares = { ...(doc.shares ?? {}), [userId]: level };
  return ok({ docId: id, userId, access: level });
}

export function archiveDoc(store, actorId, id) {
  const { doc, error } = access(store, actorId, id, 'archive');
  if (error) return error;
  doc.archived = true;
  return ok(view(doc));
}
