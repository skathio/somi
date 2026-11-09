// Driver medicals. The clinic caps a booking.
import { makeMedicalsEntry } from './model.mjs';
import { priceMedicals } from './rules.mjs';

export function recordMedicals(store, input) {
  const entry = makeMedicalsEntry(store.nextId(), input, store.clock());
  entry.amount = priceMedicals(entry.drivers, entry.rate);
  (store.medicals ??= []).push(entry);
  return entry;
}

export function voidMedicals(store, id) {
  const entry = (store.medicals ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such medicals entry: ' + id);
  entry.voided = true;
  return entry;
}

export function medicalsTotal(store) {
  const open = (store.medicals ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestMedicals(store, count = 5) {
  return [...(store.medicals ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestMedicals(store) {
  let best = null;
  for (const entry of store.medicals ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
