// Compliance audits. The auditor caps an engagement.
import { makeAuditsEntry } from './model.mjs';
import { priceAudits } from './rules.mjs';

export function logAudits(store, input) {
  const entry = makeAuditsEntry(store.nextId(), input, store.clock());
  entry.amount = priceAudits(entry.sites, entry.rate);
  (store.audits ??= []).push(entry);
  return entry;
}

export function voidAudits(store, id) {
  const entry = (store.audits ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such audits entry: ' + id);
  entry.voided = true;
  return entry;
}

export function auditsTotal(store) {
  const amounts = (store.audits ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestAudits(store, count = 5) {
  return [...(store.audits ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestAudits(store) {
  let best = null;
  for (const entry of store.audits ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
