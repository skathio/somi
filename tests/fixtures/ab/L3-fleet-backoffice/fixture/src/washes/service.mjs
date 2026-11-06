// Vehicle washes. Washes beyond the monthly block are cheaper.
import { makeWashesEntry } from './model.mjs';
import { priceWashes } from './rules.mjs';

export function logWashes(store, input) {
  const entry = makeWashesEntry(store.nextId(), input, store.clock());
  entry.amount = priceWashes(entry.washes, entry.rate);
  (store.washes ??= []).push(entry);
  return entry;
}

export function voidWashes(store, id) {
  const entry = (store.washes ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such washes entry: ' + id);
  entry.voided = true;
  return entry;
}

export function washesTotal(store) {
  const amounts = (store.washes ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestWashes(store, count = 5) {
  return [...(store.washes ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestWashes(store) {
  let best = null;
  for (const entry of store.washes ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
