// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validPallets } from './model.mjs';
import { pricePallets } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function addPallets(store, tenantId, input) {
  if (!validPallets(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, pallets: input.pallets, rate: input.rate, at: store.clock(), amount: pricePallets(input.pallets, input.rate), voided: false };
  (store.pallets ??= []).push(entry);
  note(store, 'pallets.added', entry.id);
  return ok(entry);
}
export function voidPallets(store, tenantId, id) {
  const entry = (store.pallets ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'pallets.voided', entry.id);
  return ok(entry);
}
export function palletsTotal(store, tenantId) {
  return (store.pallets ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
