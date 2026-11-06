// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTires } from './model.mjs';
import { priceTires } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function registerTires(store, tenantId, input) {
  if (!validTires(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, tires: input.tires, rate: input.rate, at: store.clock(), amount: priceTires(input.tires, input.rate), voided: false };
  (store.tires ??= []).push(entry);
  note(store, 'tires.added', entry.id);
  return ok(entry);
}
export function voidTires(store, tenantId, id) {
  const entry = (store.tires ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'tires.voided', entry.id);
  return ok(entry);
}
export function tiresTotal(store, tenantId) {
  return (store.tires ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
