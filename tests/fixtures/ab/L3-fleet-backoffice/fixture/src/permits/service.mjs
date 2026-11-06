// City permits. The council caps what one application can cost.
import { makePermitsEntry } from './model.mjs';
import { pricePermits } from './rules.mjs';

export function registerPermits(store, input) {
  const entry = makePermitsEntry(store.nextId(), input, store.clock());
  entry.amount = pricePermits(entry.permits, entry.rate);
  (store.permits ??= []).push(entry);
  return entry;
}

export function voidPermits(store, id) {
  const entry = (store.permits ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such permits entry: ' + id);
  entry.voided = true;
  return entry;
}

export function permitsTotal(store) {
  let sum = 0;
  for (const entry of store.permits ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestPermits(store, count = 5) {
  return [...(store.permits ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestPermits(store) {
  let best = null;
  for (const entry of store.permits ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
