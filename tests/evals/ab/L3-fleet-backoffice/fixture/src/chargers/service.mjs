// Charging sessions. Sessions beyond the monthly block are cheaper.
import { makeChargersEntry } from './model.mjs';
import { priceChargers } from './rules.mjs';

export function logChargers(store, input) {
  const entry = makeChargersEntry(store.nextId(), input, store.clock());
  entry.amount = priceChargers(entry.sessions, entry.rate);
  (store.chargers ??= []).push(entry);
  return entry;
}

export function voidChargers(store, id) {
  const entry = (store.chargers ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such chargers entry: ' + id);
  entry.voided = true;
  return entry;
}

export function chargersTotal(store) {
  const open = (store.chargers ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestChargers(store, count = 5) {
  return [...(store.chargers ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestChargers(store) {
  let best = null;
  for (const entry of store.chargers ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
