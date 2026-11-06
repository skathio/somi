// Courier runs. Large runs carry a depot fee.
import { makeCouriersEntry } from './model.mjs';
import { priceCouriers } from './rules.mjs';

export function recordCouriers(store, input) {
  const entry = makeCouriersEntry(store.nextId(), input, store.clock());
  entry.amount = priceCouriers(entry.parcels, entry.rate);
  (store.couriers ??= []).push(entry);
  return entry;
}

export function voidCouriers(store, id) {
  const entry = (store.couriers ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such couriers entry: ' + id);
  entry.voided = true;
  return entry;
}

export function couriersTotal(store) {
  const amounts = (store.couriers ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestCouriers(store, count = 5) {
  return [...(store.couriers ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestCouriers(store) {
  let best = null;
  for (const entry of store.couriers ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
