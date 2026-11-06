import { fail, ok } from './result.mjs';

const view = (d) => ({ id: d.id, orgId: d.orgId, ownerId: d.ownerId, title: d.title, body: d.body, archived: d.archived });
const has = (user, ...roles) => roles.some((r) => user.roles.includes(r));

export function createDoc(store, actorId, { title, body } = {}) {
  const user = store.users.get(actorId);
  if (!user || !has(user, 'editor', 'admin')) return fail('forbidden');
  if (typeof title !== 'string' || title === '' || typeof body !== 'string') return fail('invalid');
  const doc = { id: store.nextId('doc'), orgId: user.orgId, ownerId: user.id, title, body, archived: false };
  store.docs.set(doc.id, doc);
  return ok(view(doc));
}

export function readDoc(store, actorId, id) {
  const user = store.users.get(actorId);
  const doc = store.docs.get(id);
  if (!doc) return fail('not_found');
  if (!user || user.orgId !== doc.orgId) return fail('forbidden');
  if (doc.ownerId !== user.id && !has(user, 'viewer', 'editor', 'admin')) return fail('forbidden');
  return ok(view(doc));
}

export function updateDoc(store, actorId, id, { title, body } = {}) {
  const user = store.users.get(actorId);
  const doc = store.docs.get(id);
  if (!doc) return fail('not_found');
  if (!user || user.orgId !== doc.orgId) return fail('forbidden');
  if (doc.ownerId !== user.id && !has(user, 'editor', 'admin')) return fail('forbidden');
  if (title !== undefined) doc.title = title;
  if (body !== undefined) doc.body = body;
  return ok(view(doc));
}

export function deleteDoc(store, actorId, id) {
  const user = store.users.get(actorId);
  const doc = store.docs.get(id);
  if (!doc) return fail('not_found');
  if (!user || user.orgId !== doc.orgId) return fail('forbidden');
  if (doc.ownerId !== user.id && !has(user, 'admin')) return fail('forbidden');
  store.docs.delete(id);
  return ok({ deleted: id });
}
