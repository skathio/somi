// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTowing } from './model.mjs';
import { priceTowing } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function addTowing(store, tenantId, input) {
  if (!validTowing(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, km: input.km, rate: input.rate, at: store.clock(), amount: priceTowing(input.km, input.rate), voided: false };
  (store.towing ??= []).push(entry);
  note(store, 'towing.added', entry.id);
  return ok(entry);
}
export function voidTowing(store, tenantId, id) {
  const entry = (store.towing ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'towing.voided', entry.id);
  return ok(entry);
}
export function towingTotal(store, tenantId) {
  return (store.towing ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
