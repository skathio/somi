// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validConsumables } from './model.mjs';
import { priceConsumables } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerConsumables(store, tenantId, input) {
  if (!validConsumables(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, boxes: input.boxes, rate: input.rate, at: store.clock(), amount: priceConsumables(input.boxes, input.rate), voided: false };
  (store.consumables ??= []).push(entry);
  note(store, 'consumables.added', entry.id);
  return ok(entry);
}
export function voidConsumables(store, tenantId, id) {
  const entry = (store.consumables ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'consumables.voided', entry.id);
  return ok(entry);
}
export function consumablesTotal(store, tenantId) {
  return (store.consumables ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
