// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validCustoms } from './model.mjs';
import { priceCustoms } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logCustoms(store, tenantId, input) {
  if (!validCustoms(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, declarations: input.declarations, rate: input.rate, at: store.clock(), amount: priceCustoms(input.declarations, input.rate), voided: false };
  (store.customs ??= []).push(entry);
  note(store, 'customs.added', entry.id);
  return ok(entry);
}
export function voidCustoms(store, tenantId, id) {
  const entry = (store.customs ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'customs.voided', entry.id);
  return ok(entry);
}
export function customsTotal(store, tenantId) {
  return (store.customs ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
