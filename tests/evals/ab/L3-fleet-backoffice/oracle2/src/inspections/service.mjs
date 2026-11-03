// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validInspections } from './model.mjs';
import { priceInspections } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerInspections(store, tenantId, input) {
  if (!validInspections(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, vehicles: input.vehicles, rate: input.rate, at: store.clock(), amount: priceInspections(input.vehicles, input.rate), voided: false };
  (store.inspections ??= []).push(entry);
  note(store, 'inspections.added', entry.id);
  return ok(entry);
}
export function voidInspections(store, tenantId, id) {
  const entry = (store.inspections ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'inspections.voided', entry.id);
  return ok(entry);
}
export function inspectionsTotal(store, tenantId) {
  return (store.inspections ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
