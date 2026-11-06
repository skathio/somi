// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validFuel } from './model.mjs';
import { priceFuel } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function addFuel(store, tenantId, input) {
  if (!validFuel(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, litres: input.litres, rate: input.rate, at: store.clock(), amount: priceFuel(input.litres, input.rate), voided: false };
  (store.fuel ??= []).push(entry);
  note(store, 'fuel.added', entry.id);
  return ok(entry);
}
export function voidFuel(store, tenantId, id) {
  const entry = (store.fuel ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'fuel.voided', entry.id);
  return ok(entry);
}
export function fuelTotal(store, tenantId) {
  return (store.fuel ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
