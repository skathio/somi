// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTraining } from './model.mjs';
import { priceTraining } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function logTraining(store, tenantId, input) {
  if (!validTraining(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, seats: input.seats, rate: input.rate, at: store.clock(), amount: priceTraining(input.seats, input.rate), voided: false };
  (store.training ??= []).push(entry);
  note(store, 'training.added', entry.id);
  return ok(entry);
}
export function voidTraining(store, tenantId, id) {
  const entry = (store.training ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'training.voided', entry.id);
  return ok(entry);
}
export function trainingTotal(store, tenantId) {
  return (store.training ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
