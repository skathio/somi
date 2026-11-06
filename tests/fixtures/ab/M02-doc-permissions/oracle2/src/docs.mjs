// SOMI-CANARY-M02-62b47d0a708fba91
import { can } from './policy.mjs';
import { fail, ok } from './result.mjs';

const pick = ({ id, orgId, ownerId, title, body, archived }) => ({ id, orgId, ownerId, title, body, archived });

function guard(store, actorId, id, action, then) {
  const doc = store.docs.get(id);
  if (doc === undefined) return fail('not_found');
  const actor = store.users.get(actorId);
  const hidden = actor !== undefined && actor.orgId !== doc.orgId;
  if (hidden || !can(store, actorId, action, doc)) {
    store.denials.push({ action, by: actorId, id, at: store.clock() });
    return fail(hidden ? 'not_found' : 'forbidden');
  }
  return then(doc);
}

export function createDoc(store, actorId, input = {}) {
  if (!can(store, actorId, 'create', null)) {
    store.denials.push({ action: 'create', by: actorId, id: null, at: store.clock() });
    return fail('forbidden');
  }
  const { title, body } = input;
  if (typeof title !== 'string' || !title || typeof body !== 'string') return fail('invalid');
  const owner = store.users.get(actorId);
  const doc = { id: store.nextId('doc'), orgId: owner.orgId, ownerId: actorId, title, body, archived: false, shares: {} };
  store.docs.set(doc.id, doc);
  return ok(pick(doc));
}
export const readDoc = (store, actorId, id) => guard(store, actorId, id, 'read', (d) => ok(pick(d)));
export const updateDoc = (store, actorId, id, patch = {}) => guard(store, actorId, id, 'update', (d) => {
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.body !== undefined) d.body = patch.body;
  return ok(pick(d));
});
export const deleteDoc = (store, actorId, id) => guard(store, actorId, id, 'delete', () => { store.docs.delete(id); return ok({ deleted: id }); });
export const shareDoc = (store, actorId, id, opts = {}) => guard(store, actorId, id, 'share', (d) => {
  const who = store.users.get(opts.userId);
  if (!who || who.orgId !== d.orgId || (opts.access !== 'read' && opts.access !== 'edit')) return fail('invalid');
  d.shares[opts.userId] = opts.access;
  return ok({ docId: id, userId: opts.userId, access: opts.access });
});
export const archiveDoc = (store, actorId, id) => guard(store, actorId, id, 'archive', (d) => { d.archived = true; return ok(pick(d)); });
