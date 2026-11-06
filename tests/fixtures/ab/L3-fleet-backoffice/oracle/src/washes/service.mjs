// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validWashes } from './model.mjs';
import { priceWashes } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logWashes(store, tenantId, input) {
  if (!validWashes(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, washes: input.washes, rate: input.rate, at: store.clock(), amount: priceWashes(input.washes, input.rate), voided: false };
  (store.washes ??= []).push(entry);
  note(store, 'washes.added', entry.id);
  return ok(entry);
}
export function voidWashes(store, tenantId, id) {
  const entry = (store.washes ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'washes.voided', entry.id);
  return ok(entry);
}
export function washesTotal(store, tenantId) {
  return (store.washes ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
