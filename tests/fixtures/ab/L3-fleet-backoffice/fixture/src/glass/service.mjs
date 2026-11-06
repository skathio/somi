// Windscreen repairs. More than a couple on one order adds a callout fee.
import { makeGlassEntry } from './model.mjs';
import { priceGlass } from './rules.mjs';

export function recordGlass(store, input) {
  const entry = makeGlassEntry(store.nextId(), input, store.clock());
  entry.amount = priceGlass(entry.panes, entry.rate);
  (store.glass ??= []).push(entry);
  return entry;
}

export function voidGlass(store, id) {
  const entry = (store.glass ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such glass entry: ' + id);
  entry.voided = true;
  return entry;
}

export function glassTotal(store) {
  let sum = 0;
  for (const entry of store.glass ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestGlass(store, count = 5) {
  return [...(store.glass ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestGlass(store) {
  let best = null;
  for (const entry of store.glass ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
