// Long-term leases. Months past the first year are cheaper.
import { makeLeasesEntry } from './model.mjs';
import { priceLeases } from './rules.mjs';

export function registerLeases(store, input) {
  const entry = makeLeasesEntry(store.nextId(), input, store.clock());
  entry.amount = priceLeases(entry.months, entry.rate);
  (store.leases ??= []).push(entry);
  return entry;
}

export function voidLeases(store, id) {
  const entry = (store.leases ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such leases entry: ' + id);
  entry.voided = true;
  return entry;
}

export function leasesTotal(store) {
  const amounts = (store.leases ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestLeases(store, count = 5) {
  return [...(store.leases ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestLeases(store) {
  let best = null;
  for (const entry of store.leases ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
