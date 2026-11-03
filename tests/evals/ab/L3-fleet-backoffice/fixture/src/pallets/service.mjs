// Pallet hire. Pallets beyond the first block are cheaper.
import { makePalletsEntry } from './model.mjs';
import { pricePallets } from './rules.mjs';

export function addPallets(store, input) {
  const entry = makePalletsEntry(store.nextId(), input, store.clock());
  entry.amount = pricePallets(entry.pallets, entry.rate);
  (store.pallets ??= []).push(entry);
  return entry;
}

export function voidPallets(store, id) {
  const entry = (store.pallets ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such pallets entry: ' + id);
  entry.voided = true;
  return entry;
}

export function palletsTotal(store) {
  let sum = 0;
  for (const entry of store.pallets ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestPallets(store, count = 5) {
  return [...(store.pallets ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestPallets(store) {
  let best = null;
  for (const entry of store.pallets ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
