// Lamp replacements. The workshop has a minimum job value.
import { makeLightingEntry } from './model.mjs';
import { priceLighting } from './rules.mjs';

export function registerLighting(store, input) {
  const entry = makeLightingEntry(store.nextId(), input, store.clock());
  entry.amount = priceLighting(entry.lamps, entry.rate);
  (store.lighting ??= []).push(entry);
  return entry;
}

export function voidLighting(store, id) {
  const entry = (store.lighting ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such lighting entry: ' + id);
  entry.voided = true;
  return entry;
}

export function lightingTotal(store) {
  const open = (store.lighting ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestLighting(store, count = 5) {
  return [...(store.lighting ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestLighting(store) {
  let best = null;
  for (const entry of store.lighting ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
