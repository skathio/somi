// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTolls } from './model.mjs';
import { priceTolls } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function recordTolls(store, tenantId, input) {
  if (!validTolls(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, crossings: input.crossings, rate: input.rate, at: store.clock(), amount: priceTolls(input.crossings, input.rate), voided: false };
  (store.tolls ??= []).push(entry);
  note(store, 'tolls.added', entry.id);
  return ok(entry);
}
export function voidTolls(store, tenantId, id) {
  const entry = (store.tolls ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'tolls.voided', entry.id);
  return ok(entry);
}
export function tollsTotal(store, tenantId) {
  return (store.tolls ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
