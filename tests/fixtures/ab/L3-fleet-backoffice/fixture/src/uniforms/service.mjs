// Driver uniforms. The supplier has a minimum order value.
import { makeUniformsEntry } from './model.mjs';
import { priceUniforms } from './rules.mjs';

export function recordUniforms(store, input) {
  const entry = makeUniformsEntry(store.nextId(), input, store.clock());
  entry.amount = priceUniforms(entry.sets, entry.rate);
  (store.uniforms ??= []).push(entry);
  return entry;
}

export function voidUniforms(store, id) {
  const entry = (store.uniforms ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such uniforms entry: ' + id);
  entry.voided = true;
  return entry;
}

export function uniformsTotal(store) {
  const amounts = (store.uniforms ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export function latestUniforms(store, count = 5) {
  return [...(store.uniforms ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largestUniforms(store) {
  let best = null;
  for (const entry of store.uniforms ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
