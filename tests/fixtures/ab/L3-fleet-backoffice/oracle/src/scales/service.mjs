// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validScales } from './model.mjs';
import { priceScales } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function recordScales(store, tenantId, input) {
  if (!validScales(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, weighings: input.weighings, rate: input.rate, at: store.clock(), amount: priceScales(input.weighings, input.rate), voided: false };
  (store.scales ??= []).push(entry);
  note(store, 'scales.added', entry.id);
  return ok(entry);
}
export function voidScales(store, tenantId, id) {
  const entry = (store.scales ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'scales.voided', entry.id);
  return ok(entry);
}
export function scalesTotal(store, tenantId) {
  return (store.scales ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
