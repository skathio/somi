// Driver training. The provider caps a course at a block price.
import { makeTrainingEntry } from './model.mjs';
import { priceTraining } from './rules.mjs';

export function logTraining(store, input) {
  const entry = makeTrainingEntry(store.nextId(), input, store.clock());
  entry.amount = priceTraining(entry.seats, entry.rate);
  (store.training ??= []).push(entry);
  return entry;
}

export function voidTraining(store, id) {
  const entry = (store.training ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such training entry: ' + id);
  entry.voided = true;
  return entry;
}

export function trainingTotal(store) {
  let sum = 0;
  for (const entry of store.training ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestTraining(store, count = 5) {
  return [...(store.training ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTraining(store) {
  let best = null;
  for (const entry of store.training ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
