// Road tolls. The operator stops charging once the daily cap is reached.
import { makeTollsEntry } from './model.mjs';
import { priceTolls } from './rules.mjs';

export function recordTolls(store, input) {
  const entry = makeTollsEntry(store.nextId(), input, store.clock());
  entry.amount = priceTolls(entry.crossings, entry.rate);
  (store.tolls ??= []).push(entry);
  return entry;
}

export function voidTolls(store, id) {
  const entry = (store.tolls ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such tolls entry: ' + id);
  entry.voided = true;
  return entry;
}

export function tollsTotal(store) {
  const amounts = (store.tolls ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestTolls(store, count = 5) {
  return [...(store.tolls ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTolls(store) {
  let best = null;
  for (const entry of store.tolls ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
