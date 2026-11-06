// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTelemetry } from './model.mjs';
import { priceTelemetry } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function registerTelemetry(store, tenantId, input) {
  if (!validTelemetry(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, devices: input.devices, rate: input.rate, at: store.clock(), amount: priceTelemetry(input.devices, input.rate), voided: false };
  (store.telemetry ??= []).push(entry);
  note(store, 'telemetry.added', entry.id);
  return ok(entry);
}
export function voidTelemetry(store, tenantId, id) {
  const entry = (store.telemetry ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'telemetry.voided', entry.id);
  return ok(entry);
}
export function telemetryTotal(store, tenantId) {
  return (store.telemetry ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
