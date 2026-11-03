// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validAudits } from './model.mjs';
import { priceAudits } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function logAudits(store, tenantId, input) {
  if (!validAudits(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, sites: input.sites, rate: input.rate, at: store.clock(), amount: priceAudits(input.sites, input.rate), voided: false };
  (store.audits ??= []).push(entry);
  note(store, 'audits.added', entry.id);
  return ok(entry);
}
export function voidAudits(store, tenantId, id) {
  const entry = (store.audits ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'audits.voided', entry.id);
  return ok(entry);
}
export function auditsTotal(store, tenantId) {
  return (store.audits ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
