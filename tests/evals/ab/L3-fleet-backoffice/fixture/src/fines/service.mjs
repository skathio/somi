// Traffic fines. Points beyond the first few cost double, as a deterrent.
import { makeFinesEntry } from './model.mjs';
import { priceFines } from './rules.mjs';

export function recordFines(store, input) {
  const entry = makeFinesEntry(store.nextId(), input, store.clock());
  entry.amount = priceFines(entry.points, entry.rate);
  (store.fines ??= []).push(entry);
  return entry;
}

export function voidFines(store, id) {
  const entry = (store.fines ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such fines entry: ' + id);
  entry.voided = true;
  return entry;
}

export function finesTotal(store) {
  let sum = 0;
  for (const entry of store.fines ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestFines(store, count = 5) {
  return [...(store.fines ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestFines(store) {
  let best = null;
  for (const entry of store.fines ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
