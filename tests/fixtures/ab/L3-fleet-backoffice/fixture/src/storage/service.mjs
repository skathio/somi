// Depot storage. Pallets beyond the contracted block are cheaper.
import { makeStorageEntry } from './model.mjs';
import { priceStorage } from './rules.mjs';

export function recordStorage(store, input) {
  const entry = makeStorageEntry(store.nextId(), input, store.clock());
  entry.amount = priceStorage(entry.pallets, entry.rate);
  (store.storage ??= []).push(entry);
  return entry;
}

export function voidStorage(store, id) {
  const entry = (store.storage ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such storage entry: ' + id);
  entry.voided = true;
  return entry;
}

export function storageTotal(store) {
  const open = (store.storage ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestStorage(store, count = 5) {
  return [...(store.storage ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestStorage(store) {
  let best = null;
  for (const entry of store.storage ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
