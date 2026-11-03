// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validRecovery } from './model.mjs';
import { priceRecovery } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function addRecovery(store, tenantId, input) {
  if (!validRecovery(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, callouts: input.callouts, rate: input.rate, at: store.clock(), amount: priceRecovery(input.callouts, input.rate), voided: false };
  (store.recovery ??= []).push(entry);
  note(store, 'recovery.added', entry.id);
  return ok(entry);
}
export function voidRecovery(store, tenantId, id) {
  const entry = (store.recovery ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'recovery.voided', entry.id);
  return ok(entry);
}
export function recoveryTotal(store, tenantId) {
  return (store.recovery ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
