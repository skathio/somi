// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validFerries } from './model.mjs';
import { priceFerries } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logFerries(store, tenantId, input) {
  if (!validFerries(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, sailings: input.sailings, rate: input.rate, at: store.clock(), amount: priceFerries(input.sailings, input.rate), voided: false };
  (store.ferries ??= []).push(entry);
  note(store, 'ferries.added', entry.id);
  return ok(entry);
}
export function voidFerries(store, tenantId, id) {
  const entry = (store.ferries ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'ferries.voided', entry.id);
  return ok(entry);
}
export function ferriesTotal(store, tenantId) {
  return (store.ferries ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
