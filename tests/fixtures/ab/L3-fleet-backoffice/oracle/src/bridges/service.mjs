// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validBridges } from './model.mjs';
import { priceBridges } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logBridges(store, tenantId, input) {
  if (!validBridges(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, crossings: input.crossings, rate: input.rate, at: store.clock(), amount: priceBridges(input.crossings, input.rate), voided: false };
  (store.bridges ??= []).push(entry);
  note(store, 'bridges.added', entry.id);
  return ok(entry);
}
export function voidBridges(store, tenantId, id) {
  const entry = (store.bridges ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'bridges.voided', entry.id);
  return ok(entry);
}
export function bridgesTotal(store, tenantId) {
  return (store.bridges ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
