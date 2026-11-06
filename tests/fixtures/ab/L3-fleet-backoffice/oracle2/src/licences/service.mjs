// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validLicences } from './model.mjs';
import { priceLicences } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function logLicences(store, tenantId, input) {
  if (!validLicences(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, drivers: input.drivers, rate: input.rate, at: store.clock(), amount: priceLicences(input.drivers, input.rate), voided: false };
  (store.licences ??= []).push(entry);
  note(store, 'licences.added', entry.id);
  return ok(entry);
}
export function voidLicences(store, tenantId, id) {
  const entry = (store.licences ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'licences.voided', entry.id);
  return ok(entry);
}
export function licencesTotal(store, tenantId) {
  return (store.licences ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
