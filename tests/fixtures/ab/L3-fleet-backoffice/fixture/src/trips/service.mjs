// Trips charged back to customers. The first stretch of every trip is included in the call-out.
import { makeTripsEntry } from './model.mjs';
import { priceTrips } from './rules.mjs';

export function logTrips(store, input) {
  const entry = makeTripsEntry(store.nextId(), input, store.clock());
  entry.amount = priceTrips(entry.km, entry.rate);
  (store.trips ??= []).push(entry);
  return entry;
}

export function voidTrips(store, id) {
  const entry = (store.trips ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such trips entry: ' + id);
  entry.voided = true;
  return entry;
}

export function tripsTotal(store) {
  const open = (store.trips ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestTrips(store, count = 5) {
  return [...(store.trips ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTrips(store) {
  let best = null;
  for (const entry of store.trips ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
