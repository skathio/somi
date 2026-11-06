// Dispatch software. Seats beyond the first block are cheaper.
import { makeSoftwareEntry } from './model.mjs';
import { priceSoftware } from './rules.mjs';

export function registerSoftware(store, input) {
  const entry = makeSoftwareEntry(store.nextId(), input, store.clock());
  entry.amount = priceSoftware(entry.seats, entry.rate);
  (store.software ??= []).push(entry);
  return entry;
}

export function voidSoftware(store, id) {
  const entry = (store.software ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such software entry: ' + id);
  entry.voided = true;
  return entry;
}

export function softwareTotal(store) {
  const amounts = (store.software ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestSoftware(store, count = 5) {
  return [...(store.software ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestSoftware(store) {
  let best = null;
  for (const entry of store.software ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
