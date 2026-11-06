// Staff shuttles. The first runs in a roster are included.
import { makeShuttlesEntry } from './model.mjs';
import { priceShuttles } from './rules.mjs';

export function recordShuttles(store, input) {
  const entry = makeShuttlesEntry(store.nextId(), input, store.clock());
  entry.amount = priceShuttles(entry.runs, entry.rate);
  (store.shuttles ??= []).push(entry);
  return entry;
}

export function voidShuttles(store, id) {
  const entry = (store.shuttles ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such shuttles entry: ' + id);
  entry.voided = true;
  return entry;
}

export function shuttlesTotal(store) {
  let sum = 0;
  for (const entry of store.shuttles ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestShuttles(store, count = 5) {
  return [...(store.shuttles ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestShuttles(store) {
  let best = null;
  for (const entry of store.shuttles ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
