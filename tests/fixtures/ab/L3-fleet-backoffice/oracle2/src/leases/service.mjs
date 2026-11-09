// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validLeases } from './model.mjs';
import { priceLeases } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerLeases(store, tenantId, input) {
  if (!validLeases(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, months: input.months, rate: input.rate, at: store.clock(), amount: priceLeases(input.months, input.rate), voided: false };
  (store.leases ??= []).push(entry);
  note(store, 'leases.added', entry.id);
  return ok(entry);
}
export function voidLeases(store, tenantId, id) {
  const entry = (store.leases ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'leases.voided', entry.id);
  return ok(entry);
}
export function leasesTotal(store, tenantId) {
  return (store.leases ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
