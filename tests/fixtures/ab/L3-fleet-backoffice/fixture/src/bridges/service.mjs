// Bridge passes. A book of passes earns a discount.
import { makeBridgesEntry } from './model.mjs';
import { priceBridges } from './rules.mjs';

export function logBridges(store, input) {
  const entry = makeBridgesEntry(store.nextId(), input, store.clock());
  entry.amount = priceBridges(entry.crossings, entry.rate);
  (store.bridges ??= []).push(entry);
  return entry;
}

export function voidBridges(store, id) {
  const entry = (store.bridges ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such bridges entry: ' + id);
  entry.voided = true;
  return entry;
}

export function bridgesTotal(store) {
  const open = (store.bridges ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestBridges(store, count = 5) {
  return [...(store.bridges ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestBridges(store) {
  let best = null;
  for (const entry of store.bridges ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
