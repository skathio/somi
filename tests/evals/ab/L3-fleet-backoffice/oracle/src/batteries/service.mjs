// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validBatteries } from './model.mjs';
import { priceBatteries } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function addBatteries(store, tenantId, input) {
  if (!validBatteries(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, packs: input.packs, rate: input.rate, at: store.clock(), amount: priceBatteries(input.packs, input.rate), voided: false };
  (store.batteries ??= []).push(entry);
  note(store, 'batteries.added', entry.id);
  return ok(entry);
}
export function voidBatteries(store, tenantId, id) {
  const entry = (store.batteries ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'batteries.voided', entry.id);
  return ok(entry);
}
export function batteriesTotal(store, tenantId) {
  return (store.batteries ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
