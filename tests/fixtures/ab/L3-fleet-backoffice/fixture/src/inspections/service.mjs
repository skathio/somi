// Safety inspections. The inspector charges a minimum per visit.
import { makeInspectionsEntry } from './model.mjs';
import { priceInspections } from './rules.mjs';

export function registerInspections(store, input) {
  const entry = makeInspectionsEntry(store.nextId(), input, store.clock());
  entry.amount = priceInspections(entry.vehicles, entry.rate);
  (store.inspections ??= []).push(entry);
  return entry;
}

export function voidInspections(store, id) {
  const entry = (store.inspections ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such inspections entry: ' + id);
  entry.voided = true;
  return entry;
}

export function inspectionsTotal(store) {
  const open = (store.inspections ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestInspections(store, count = 5) {
  return [...(store.inspections ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestInspections(store) {
  let best = null;
  for (const entry of store.inspections ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
