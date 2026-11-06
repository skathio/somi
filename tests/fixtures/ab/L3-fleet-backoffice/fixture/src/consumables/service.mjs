// Workshop consumables. The first few boxes are covered by the contract.
import { makeConsumablesEntry } from './model.mjs';
import { priceConsumables } from './rules.mjs';

export function registerConsumables(store, input) {
  const entry = makeConsumablesEntry(store.nextId(), input, store.clock());
  entry.amount = priceConsumables(entry.boxes, entry.rate);
  (store.consumables ??= []).push(entry);
  return entry;
}

export function voidConsumables(store, id) {
  const entry = (store.consumables ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such consumables entry: ' + id);
  entry.voided = true;
  return entry;
}

export function consumablesTotal(store) {
  let sum = 0;
  for (const entry of store.consumables ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestConsumables(store, count = 5) {
  return [...(store.consumables ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestConsumables(store) {
  let best = null;
  for (const entry of store.consumables ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
