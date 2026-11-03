// Short-term rentals. A week or longer earns a discount.
import { makeRentalsEntry } from './model.mjs';
import { priceRentals } from './rules.mjs';

export function addRentals(store, input) {
  const entry = makeRentalsEntry(store.nextId(), input, store.clock());
  entry.amount = priceRentals(entry.days, entry.rate);
  (store.rentals ??= []).push(entry);
  return entry;
}

export function voidRentals(store, id) {
  const entry = (store.rentals ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such rentals entry: ' + id);
  entry.voided = true;
  return entry;
}

export function rentalsTotal(store) {
  const open = (store.rentals ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestRentals(store, count = 5) {
  return [...(store.rentals ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestRentals(store) {
  let best = null;
  for (const entry of store.rentals ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
