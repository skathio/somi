// Breakdown recovery. After the included level, callouts cost double.
import { makeRecoveryEntry } from './model.mjs';
import { priceRecovery } from './rules.mjs';

export function addRecovery(store, input) {
  const entry = makeRecoveryEntry(store.nextId(), input, store.clock());
  entry.amount = priceRecovery(entry.callouts, entry.rate);
  (store.recovery ??= []).push(entry);
  return entry;
}

export function voidRecovery(store, id) {
  const entry = (store.recovery ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such recovery entry: ' + id);
  entry.voided = true;
  return entry;
}

export function recoveryTotal(store) {
  const amounts = (store.recovery ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestRecovery(store, count = 5) {
  return [...(store.recovery ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestRecovery(store) {
  let best = null;
  for (const entry of store.recovery ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
