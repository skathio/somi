// Telemetry subscriptions. The vendor caps a fleet account.
import { makeTelemetryEntry } from './model.mjs';
import { priceTelemetry } from './rules.mjs';

export function registerTelemetry(store, input) {
  const entry = makeTelemetryEntry(store.nextId(), input, store.clock());
  entry.amount = priceTelemetry(entry.devices, entry.rate);
  (store.telemetry ??= []).push(entry);
  return entry;
}

export function voidTelemetry(store, id) {
  const entry = (store.telemetry ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such telemetry entry: ' + id);
  entry.voided = true;
  return entry;
}

export function telemetryTotal(store) {
  let sum = 0;
  for (const entry of store.telemetry ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestTelemetry(store, count = 5) {
  return [...(store.telemetry ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTelemetry(store) {
  let best = null;
  for (const entry of store.telemetry ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
