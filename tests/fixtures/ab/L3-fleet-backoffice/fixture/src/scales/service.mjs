// Weighbridge fees. Heavy use in a period adds a service fee.
import { makeScalesEntry } from './model.mjs';
import { priceScales } from './rules.mjs';

export function recordScales(store, input) {
  const entry = makeScalesEntry(store.nextId(), input, store.clock());
  entry.amount = priceScales(entry.weighings, entry.rate);
  (store.scales ??= []).push(entry);
  return entry;
}

export function voidScales(store, id) {
  const entry = (store.scales ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such scales entry: ' + id);
  entry.voided = true;
  return entry;
}

export function scalesTotal(store) {
  const amounts = (store.scales ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestScales(store, count = 5) {
  return [...(store.scales ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestScales(store) {
  let best = null;
  for (const entry of store.scales ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
