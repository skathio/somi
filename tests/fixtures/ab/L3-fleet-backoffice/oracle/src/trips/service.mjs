// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTrips } from './model.mjs';
import { priceTrips } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logTrips(store, tenantId, input) {
  if (!validTrips(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, km: input.km, rate: input.rate, at: store.clock(), amount: priceTrips(input.km, input.rate), voided: false };
  (store.trips ??= []).push(entry);
  note(store, 'trips.added', entry.id);
  return ok(entry);
}
export function voidTrips(store, tenantId, id) {
  const entry = (store.trips ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'trips.voided', entry.id);
  return ok(entry);
}
export function tripsTotal(store, tenantId) {
  return (store.trips ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
