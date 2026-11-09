// Towing. The first stretch of a tow is covered by the callout.
import { makeTowingEntry } from './model.mjs';
import { priceTowing } from './rules.mjs';

export function addTowing(store, input) {
  const entry = makeTowingEntry(store.nextId(), input, store.clock());
  entry.amount = priceTowing(entry.km, entry.rate);
  (store.towing ??= []).push(entry);
  return entry;
}

export function voidTowing(store, id) {
  const entry = (store.towing ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such towing entry: ' + id);
  entry.voided = true;
  return entry;
}

export function towingTotal(store) {
  const amounts = (store.towing ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestTowing(store, count = 5) {
  return [...(store.towing ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTowing(store) {
  let best = null;
  for (const entry of store.towing ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
