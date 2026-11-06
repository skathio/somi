// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validCleaning } from './model.mjs';
import { priceCleaning } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function addCleaning(store, tenantId, input) {
  if (!validCleaning(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, cabins: input.cabins, rate: input.rate, at: store.clock(), amount: priceCleaning(input.cabins, input.rate), voided: false };
  (store.cleaning ??= []).push(entry);
  note(store, 'cleaning.added', entry.id);
  return ok(entry);
}
export function voidCleaning(store, tenantId, id) {
  const entry = (store.cleaning ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'cleaning.voided', entry.id);
  return ok(entry);
}
export function cleaningTotal(store, tenantId) {
  return (store.cleaning ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
