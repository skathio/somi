// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validRentals } from './model.mjs';
import { priceRentals } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function addRentals(store, tenantId, input) {
  if (!validRentals(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, days: input.days, rate: input.rate, at: store.clock(), amount: priceRentals(input.days, input.rate), voided: false };
  (store.rentals ??= []).push(entry);
  note(store, 'rentals.added', entry.id);
  return ok(entry);
}
export function voidRentals(store, tenantId, id) {
  const entry = (store.rentals ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'rentals.voided', entry.id);
  return ok(entry);
}
export function rentalsTotal(store, tenantId) {
  return (store.rentals ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
