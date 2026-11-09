// Cabin cleaning. The first few cabins are covered by the depot contract.
import { makeCleaningEntry } from './model.mjs';
import { priceCleaning } from './rules.mjs';

export function addCleaning(store, input) {
  const entry = makeCleaningEntry(store.nextId(), input, store.clock());
  entry.amount = priceCleaning(entry.cabins, entry.rate);
  (store.cleaning ??= []).push(entry);
  return entry;
}

export function voidCleaning(store, id) {
  const entry = (store.cleaning ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such cleaning entry: ' + id);
  entry.voided = true;
  return entry;
}

export function cleaningTotal(store) {
  const open = (store.cleaning ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestCleaning(store, count = 5) {
  return [...(store.cleaning ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestCleaning(store) {
  let best = null;
  for (const entry of store.cleaning ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
