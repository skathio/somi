// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validUniforms } from './model.mjs';
import { priceUniforms } from './rules.mjs';
import { fail, ok, note } from '../shared.mjs';

export function recordUniforms(store, tenantId, input) {
  if (!validUniforms(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, sets: input.sets, rate: input.rate, at: store.clock(), amount: priceUniforms(input.sets, input.rate), voided: false };
  (store.uniforms ??= []).push(entry);
  note(store, 'uniforms.added', entry.id);
  return ok(entry);
}
export function voidUniforms(store, tenantId, id) {
  const entry = (store.uniforms ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'uniforms.voided', entry.id);
  return ok(entry);
}
export function uniformsTotal(store, tenantId) {
  return (store.uniforms ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
