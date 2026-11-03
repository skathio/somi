// SOMI-CANARY-L3-5d1e7ac94b02f863
import { validTenders } from './model.mjs';
import { priceTenders } from './rules.mjs';
const ok = (value) => ({ ok: true, value });
const fail = (code) => ({ ok: false, error: { code } });
const note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };

export function addTenders(store, tenantId, input) {
  if (!validTenders(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, bids: input.bids, rate: input.rate, at: store.clock(), amount: priceTenders(input.bids, input.rate), voided: false };
  (store.tenders ??= []).push(entry);
  note(store, 'tenders.added', entry.id);
  return ok(entry);
}
export function voidTenders(store, tenantId, id) {
  const entry = (store.tenders ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, 'tenders.voided', entry.id);
  return ok(entry);
}
export function tendersTotal(store, tenantId) {
  return (store.tenders ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
