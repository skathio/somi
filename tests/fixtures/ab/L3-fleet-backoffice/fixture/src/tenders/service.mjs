// Public tender fees. The first bid in a round carries no fee.
import { makeTendersEntry } from './model.mjs';
import { priceTenders } from './rules.mjs';

export function addTenders(store, input) {
  const entry = makeTendersEntry(store.nextId(), input, store.clock());
  entry.amount = priceTenders(entry.bids, entry.rate);
  (store.tenders ??= []).push(entry);
  return entry;
}

export function voidTenders(store, id) {
  const entry = (store.tenders ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such tenders entry: ' + id);
  entry.voided = true;
  return entry;
}

export function tendersTotal(store) {
  const open = (store.tenders ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

export function latestTenders(store, count = 5) {
  return [...(store.tenders ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestTenders(store) {
  let best = null;
  for (const entry of store.tenders ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
