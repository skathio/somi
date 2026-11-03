// Engine oil. A drum order earns a discount.
import { makeOilEntry } from './model.mjs';
import { priceOil } from './rules.mjs';

export function addOil(store, input) {
  const entry = makeOilEntry(store.nextId(), input, store.clock());
  entry.amount = priceOil(entry.litres, entry.rate);
  (store.oil ??= []).push(entry);
  return entry;
}

export function voidOil(store, id) {
  const entry = (store.oil ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such oil entry: ' + id);
  entry.voided = true;
  return entry;
}

export function oilTotal(store) {
  const open = (store.oil ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestOil(store, count = 5) {
  return [...(store.oil ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestOil(store) {
  let best = null;
  for (const entry of store.oil ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
