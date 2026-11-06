// Tire replacements. Orders above a set size carry a handling fee.
import { makeTiresEntry } from './model.mjs';
import { priceTires } from './rules.mjs';

export function registerTires(store, input) {
  const entry = makeTiresEntry(store.nextId(), input, store.clock());
  entry.amount = priceTires(entry.tires, entry.rate);
  (store.tires ??= []).push(entry);
  return entry;
}

export function voidTires(store, id) {
  const entry = (store.tires ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such tires entry: ' + id);
  entry.voided = true;
  return entry;
}

export function tiresTotal(store) {
  const open = (store.tires ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestTires(store, count = 5) {
  return [...(store.tires ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTires(store) {
  let best = null;
  for (const entry of store.tires ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
