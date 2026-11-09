// Fuel bought on a company card. Bulk fills earn a discount from the supplier contract.
import { makeFuelEntry } from './model.mjs';
import { priceFuel } from './rules.mjs';

export function addFuel(store, input) {
  const entry = makeFuelEntry(store.nextId(), input, store.clock());
  entry.amount = priceFuel(entry.litres, entry.rate);
  (store.fuel ??= []).push(entry);
  return entry;
}

export function voidFuel(store, id) {
  const entry = (store.fuel ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such fuel entry: ' + id);
  entry.voided = true;
  return entry;
}

export function fuelTotal(store) {
  let sum = 0;
  for (const entry of store.fuel ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestFuel(store, count = 5) {
  return [...(store.fuel ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestFuel(store) {
  let best = null;
  for (const entry of store.fuel ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
