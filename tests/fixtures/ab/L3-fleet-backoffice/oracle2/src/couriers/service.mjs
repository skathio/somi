// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validCouriers } from './model.mjs';
import { priceCouriers } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordCouriers(store, tenantId, input) {
  if (!validCouriers(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, parcels: input.parcels, rate: input.rate, at: store.clock(), amount: priceCouriers(input.parcels, input.rate), voided: false };
  (store.couriers ??= []).push(entry);
  note(store, 'couriers.added', entry.id);
  return ok(entry);
}
export function voidCouriers(store, tenantId, id) {
  const entry = (store.couriers ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'couriers.voided', entry.id);
  return ok(entry);
}
export function couriersTotal(store, tenantId) {
  return (store.couriers ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
