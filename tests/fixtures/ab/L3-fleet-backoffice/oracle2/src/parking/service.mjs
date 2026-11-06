// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validParking } from './model.mjs';
import { priceParking } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function addParking(store, tenantId, input) {
  if (!validParking(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, hours: input.hours, rate: input.rate, at: store.clock(), amount: priceParking(input.hours, input.rate), voided: false };
  (store.parking ??= []).push(entry);
  note(store, 'parking.added', entry.id);
  return ok(entry);
}
export function voidParking(store, tenantId, id) {
  const entry = (store.parking ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'parking.voided', entry.id);
  return ok(entry);
}
export function parkingTotal(store, tenantId) {
  return (store.parking ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
