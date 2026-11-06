// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTachographs } from './model.mjs';
import { priceTachographs } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerTachographs(store, tenantId, input) {
  if (!validTachographs(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, units: input.units, rate: input.rate, at: store.clock(), amount: priceTachographs(input.units, input.rate), voided: false };
  (store.tachographs ??= []).push(entry);
  note(store, 'tachographs.added', entry.id);
  return ok(entry);
}
export function voidTachographs(store, tenantId, id) {
  const entry = (store.tachographs ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'tachographs.voided', entry.id);
  return ok(entry);
}
export function tachographsTotal(store, tenantId) {
  return (store.tachographs ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
