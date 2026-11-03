// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validPermits } from './model.mjs';
import { pricePermits } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerPermits(store, tenantId, input) {
  if (!validPermits(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, permits: input.permits, rate: input.rate, at: store.clock(), amount: pricePermits(input.permits, input.rate), voided: false };
  (store.permits ??= []).push(entry);
  note(store, 'permits.added', entry.id);
  return ok(entry);
}
export function voidPermits(store, tenantId, id) {
  const entry = (store.permits ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'permits.voided', entry.id);
  return ok(entry);
}
export function permitsTotal(store, tenantId) {
  return (store.permits ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
