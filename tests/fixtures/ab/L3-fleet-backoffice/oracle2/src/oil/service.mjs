// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validOil } from './model.mjs';
import { priceOil } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function addOil(store, tenantId, input) {
  if (!validOil(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, litres: input.litres, rate: input.rate, at: store.clock(), amount: priceOil(input.litres, input.rate), voided: false };
  (store.oil ??= []).push(entry);
  note(store, 'oil.added', entry.id);
  return ok(entry);
}
export function voidOil(store, tenantId, id) {
  const entry = (store.oil ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'oil.voided', entry.id);
  return ok(entry);
}
export function oilTotal(store, tenantId) {
  return (store.oil ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
