// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validSoftware } from './model.mjs';
import { priceSoftware } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerSoftware(store, tenantId, input) {
  if (!validSoftware(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, seats: input.seats, rate: input.rate, at: store.clock(), amount: priceSoftware(input.seats, input.rate), voided: false };
  (store.software ??= []).push(entry);
  note(store, 'software.added', entry.id);
  return ok(entry);
}
export function voidSoftware(store, tenantId, id) {
  const entry = (store.software ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'software.voided', entry.id);
  return ok(entry);
}
export function softwareTotal(store, tenantId) {
  return (store.software ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
