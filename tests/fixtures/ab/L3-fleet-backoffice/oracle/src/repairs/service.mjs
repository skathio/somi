// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validRepairs } from './model.mjs';
import { priceRepairs } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logRepairs(store, tenantId, input) {
  if (!validRepairs(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, hours: input.hours, rate: input.rate, at: store.clock(), amount: priceRepairs(input.hours, input.rate), voided: false };
  (store.repairs ??= []).push(entry);
  note(store, 'repairs.added', entry.id);
  return ok(entry);
}
export function voidRepairs(store, tenantId, id) {
  const entry = (store.repairs ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'repairs.voided', entry.id);
  return ok(entry);
}
export function repairsTotal(store, tenantId) {
  return (store.repairs ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
