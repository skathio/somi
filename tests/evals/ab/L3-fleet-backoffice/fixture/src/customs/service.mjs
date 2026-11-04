// Customs declarations. Beyond the first few, the agent charges double.
import { makeCustomsEntry } from './model.mjs';
import { priceCustoms } from './rules.mjs';

export function logCustoms(store, input) {
  const entry = makeCustomsEntry(store.nextId(), input, store.clock());
  entry.amount = priceCustoms(entry.declarations, entry.rate);
  (store.customs ??= []).push(entry);
  return entry;
}

export function voidCustoms(store, id) {
  const entry = (store.customs ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such customs entry: ' + id);
  entry.voided = true;
  return entry;
}

export function customsTotal(store) {
  const amounts = (store.customs ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestCustoms(store, count = 5) {
  return [...(store.customs ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestCustoms(store) {
  let best = null;
  for (const entry of store.customs ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
