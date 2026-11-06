// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validRadios } from './model.mjs';
import { priceRadios } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function addRadios(store, tenantId, input) {
  if (!validRadios(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, units: input.units, rate: input.rate, at: store.clock(), amount: priceRadios(input.units, input.rate), voided: false };
  (store.radios ??= []).push(entry);
  note(store, 'radios.added', entry.id);
  return ok(entry);
}
export function voidRadios(store, tenantId, id) {
  const entry = (store.radios ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'radios.voided', entry.id);
  return ok(entry);
}
export function radiosTotal(store, tenantId) {
  return (store.radios ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
