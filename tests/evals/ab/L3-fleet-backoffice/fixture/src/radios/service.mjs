// Radio licences. Units past the base licence cost double.
import { makeRadiosEntry } from './model.mjs';
import { priceRadios } from './rules.mjs';

export function addRadios(store, input) {
  const entry = makeRadiosEntry(store.nextId(), input, store.clock());
  entry.amount = priceRadios(entry.units, entry.rate);
  (store.radios ??= []).push(entry);
  return entry;
}

export function voidRadios(store, id) {
  const entry = (store.radios ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such radios entry: ' + id);
  entry.voided = true;
  return entry;
}

export function radiosTotal(store) {
  let sum = 0;
  for (const entry of store.radios ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestRadios(store, count = 5) {
  return [...(store.radios ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestRadios(store) {
  let best = null;
  for (const entry of store.radios ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
