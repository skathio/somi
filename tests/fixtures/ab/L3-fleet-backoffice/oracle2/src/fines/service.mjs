// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validFines } from './model.mjs';
import { priceFines } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordFines(store, tenantId, input) {
  if (!validFines(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, points: input.points, rate: input.rate, at: store.clock(), amount: priceFines(input.points, input.rate), voided: false };
  (store.fines ??= []).push(entry);
  note(store, 'fines.added', entry.id);
  return ok(entry);
}
export function voidFines(store, tenantId, id) {
  const entry = (store.fines ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'fines.voided', entry.id);
  return ok(entry);
}
export function finesTotal(store, tenantId) {
  return (store.fines ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
