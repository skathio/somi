// Insurance premiums. The broker has a minimum premium per policy.
import { makeInsuranceEntry } from './model.mjs';
import { priceInsurance } from './rules.mjs';

export function recordInsurance(store, input) {
  const entry = makeInsuranceEntry(store.nextId(), input, store.clock());
  entry.amount = priceInsurance(entry.vehicles, entry.rate);
  (store.insurance ??= []).push(entry);
  return entry;
}

export function voidInsurance(store, id) {
  const entry = (store.insurance ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such insurance entry: ' + id);
  entry.voided = true;
  return entry;
}

export function insuranceTotal(store) {
  let sum = 0;
  for (const entry of store.insurance ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;
}

export function latestInsurance(store, count = 5) {
  return [...(store.insurance ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestInsurance(store) {
  let best = null;
  for (const entry of store.insurance ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
