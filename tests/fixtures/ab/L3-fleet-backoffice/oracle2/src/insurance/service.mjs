// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validInsurance } from './model.mjs';
import { priceInsurance } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordInsurance(store, tenantId, input) {
  if (!validInsurance(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, vehicles: input.vehicles, rate: input.rate, at: store.clock(), amount: priceInsurance(input.vehicles, input.rate), voided: false };
  (store.insurance ??= []).push(entry);
  note(store, 'insurance.added', entry.id);
  return ok(entry);
}
export function voidInsurance(store, tenantId, id) {
  const entry = (store.insurance ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'insurance.voided', entry.id);
  return ok(entry);
}
export function insuranceTotal(store, tenantId) {
  return (store.insurance ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
