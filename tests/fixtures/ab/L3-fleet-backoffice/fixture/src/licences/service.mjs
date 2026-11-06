// Driver licence checks. The agency has a minimum charge.
import { makeLicencesEntry } from './model.mjs';
import { priceLicences } from './rules.mjs';

export function logLicences(store, input) {
  const entry = makeLicencesEntry(store.nextId(), input, store.clock());
  entry.amount = priceLicences(entry.drivers, entry.rate);
  (store.licences ??= []).push(entry);
  return entry;
}

export function voidLicences(store, id) {
  const entry = (store.licences ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such licences entry: ' + id);
  entry.voided = true;
  return entry;
}

export function licencesTotal(store) {
  let sum = 0;
  for (const entry of store.licences ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestLicences(store, count = 5) {
  return [...(store.licences ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestLicences(store) {
  let best = null;
  for (const entry of store.licences ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
