// Workshop repairs. Long jobs carry a supervisor fee.
import { makeRepairsEntry } from './model.mjs';
import { priceRepairs } from './rules.mjs';

export function logRepairs(store, input) {
  const entry = makeRepairsEntry(store.nextId(), input, store.clock());
  entry.amount = priceRepairs(entry.hours, entry.rate);
  (store.repairs ??= []).push(entry);
  return entry;
}

export function voidRepairs(store, id) {
  const entry = (store.repairs ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such repairs entry: ' + id);
  entry.voided = true;
  return entry;
}

export function repairsTotal(store) {
  const open = (store.repairs ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestRepairs(store, count = 5) {
  return [...(store.repairs ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestRepairs(store) {
  let best = null;
  for (const entry of store.repairs ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
