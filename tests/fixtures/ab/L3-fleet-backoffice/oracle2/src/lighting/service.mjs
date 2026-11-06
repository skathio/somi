// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validLighting } from './model.mjs';
import { priceLighting } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerLighting(store, tenantId, input) {
  if (!validLighting(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, lamps: input.lamps, rate: input.rate, at: store.clock(), amount: priceLighting(input.lamps, input.rate), voided: false };
  (store.lighting ??= []).push(entry);
  note(store, 'lighting.added', entry.id);
  return ok(entry);
}
export function voidLighting(store, tenantId, id) {
  const entry = (store.lighting ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'lighting.voided', entry.id);
  return ok(entry);
}
export function lightingTotal(store, tenantId) {
  return (store.lighting ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
