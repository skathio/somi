// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validStorage } from './model.mjs';
import { priceStorage } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function recordStorage(store, tenantId, input) {
  if (!validStorage(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, pallets: input.pallets, rate: input.rate, at: store.clock(), amount: priceStorage(input.pallets, input.rate), voided: false };
  (store.storage ??= []).push(entry);
  note(store, 'storage.added', entry.id);
  return ok(entry);
}
export function voidStorage(store, tenantId, id) {
  const entry = (store.storage ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'storage.voided', entry.id);
  return ok(entry);
}
export function storageTotal(store, tenantId) {
  return (store.storage ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
