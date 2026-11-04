// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validShuttles } from './model.mjs';
import { priceShuttles } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordShuttles(store, tenantId, input) {
  if (!validShuttles(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, runs: input.runs, rate: input.rate, at: store.clock(), amount: priceShuttles(input.runs, input.rate), voided: false };
  (store.shuttles ??= []).push(entry);
  note(store, 'shuttles.added', entry.id);
  return ok(entry);
}
export function voidShuttles(store, tenantId, id) {
  const entry = (store.shuttles ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'shuttles.voided', entry.id);
  return ok(entry);
}
export function shuttlesTotal(store, tenantId) {
  return (store.shuttles ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
