// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validGlass } from './model.mjs';
import { priceGlass } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordGlass(store, tenantId, input) {
  if (!validGlass(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, panes: input.panes, rate: input.rate, at: store.clock(), amount: priceGlass(input.panes, input.rate), voided: false };
  (store.glass ??= []).push(entry);
  note(store, 'glass.added', entry.id);
  return ok(entry);
}
export function voidGlass(store, tenantId, id) {
  const entry = (store.glass ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'glass.voided', entry.id);
  return ok(entry);
}
export function glassTotal(store, tenantId) {
  return (store.glass ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
