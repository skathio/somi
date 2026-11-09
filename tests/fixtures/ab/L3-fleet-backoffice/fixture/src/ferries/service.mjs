// Ferry crossings. A book of sailings earns a discount.
import { makeFerriesEntry } from './model.mjs';
import { priceFerries } from './rules.mjs';

export function logFerries(store, input) {
  const entry = makeFerriesEntry(store.nextId(), input, store.clock());
  entry.amount = priceFerries(entry.sailings, entry.rate);
  (store.ferries ??= []).push(entry);
  return entry;
}

export function voidFerries(store, id) {
  const entry = (store.ferries ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such ferries entry: ' + id);
  entry.voided = true;
  return entry;
}

export function ferriesTotal(store) {
  const amounts = (store.ferries ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestFerries(store, count = 5) {
  return [...(store.ferries ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestFerries(store) {
  let best = null;
  for (const entry of store.ferries ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
