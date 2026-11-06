// Battery swaps. Larger orders carry a hazardous goods fee.
import { makeBatteriesEntry } from './model.mjs';
import { priceBatteries } from './rules.mjs';

export function addBatteries(store, input) {
  const entry = makeBatteriesEntry(store.nextId(), input, store.clock());
  entry.amount = priceBatteries(entry.packs, entry.rate);
  (store.batteries ??= []).push(entry);
  return entry;
}

export function voidBatteries(store, id) {
  const entry = (store.batteries ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such batteries entry: ' + id);
  entry.voided = true;
  return entry;
}

export function batteriesTotal(store) {
  let sum = 0;
  for (const entry of store.batteries ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestBatteries(store, count = 5) {
  return [...(store.batteries ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestBatteries(store) {
  let best = null;
  for (const entry of store.batteries ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
