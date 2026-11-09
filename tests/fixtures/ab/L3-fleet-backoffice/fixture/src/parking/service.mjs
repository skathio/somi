// Parking sessions. The garage bills a minimum, however short the stay.
import { makeParkingEntry } from './model.mjs';
import { priceParking } from './rules.mjs';

export function addParking(store, input) {
  const entry = makeParkingEntry(store.nextId(), input, store.clock());
  entry.amount = priceParking(entry.hours, entry.rate);
  (store.parking ??= []).push(entry);
  return entry;
}

export function voidParking(store, id) {
  const entry = (store.parking ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such parking entry: ' + id);
  entry.voided = true;
  return entry;
}

export function parkingTotal(store) {
  let sum = 0;
  for (const entry of store.parking ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestParking(store, count = 5) {
  return [...(store.parking ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestParking(store) {
  let best = null;
  for (const entry of store.parking ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
