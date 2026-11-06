// Tachograph calibration. A large batch earns a workshop discount.
import { makeTachographsEntry } from './model.mjs';
import { priceTachographs } from './rules.mjs';

export function registerTachographs(store, input) {
  const entry = makeTachographsEntry(store.nextId(), input, store.clock());
  entry.amount = priceTachographs(entry.units, entry.rate);
  (store.tachographs ??= []).push(entry);
  return entry;
}

export function voidTachographs(store, id) {
  const entry = (store.tachographs ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such tachographs entry: ' + id);
  entry.voided = true;
  return entry;
}

export function tachographsTotal(store) {
  const amounts = (store.tachographs ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestTachographs(store, count = 5) {
  return [...(store.tachographs ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTachographs(store) {
  let best = null;
  for (const entry of store.tachographs ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
