// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validMedicals } from './model.mjs';
import { priceMedicals } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordMedicals(store, tenantId, input) {
  if (!validMedicals(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, drivers: input.drivers, rate: input.rate, at: store.clock(), amount: priceMedicals(input.drivers, input.rate), voided: false };
  (store.medicals ??= []).push(entry);
  note(store, 'medicals.added', entry.id);
  return ok(entry);
}
export function voidMedicals(store, tenantId, id) {
  const entry = (store.medicals ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'medicals.voided', entry.id);
  return ok(entry);
}
export function medicalsTotal(store, tenantId) {
  return (store.medicals ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
