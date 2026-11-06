// SOMI-CANARY-M01-749043d973a32ba5
import { addDays, daysBetween } from './dates.mjs';
import { fail, ok } from './result.mjs';
import { PERIOD_DAYS } from './store.mjs';

const view = (sub) => ({ ...sub, pending: sub.pending.map((l) => ({ ...l })) });
const record = (store, type, id) => store.audit.push({ type, at: store.clock(), id });
// Proration and refunds round in the customer's favour: what is owed back rounds up, what is charged rounds down.
const owedBack = (priceCents, days) => Math.ceil((priceCents * days) / PERIOD_DAYS);
const charged = (priceCents, days) => Math.floor((priceCents * days) / PERIOD_DAYS);

export function subscribe(store, { customerId, planId } = {}) {
  if (typeof customerId !== 'string' || customerId === '') return fail('invalid');
  if (!store.plans.has(planId)) return fail('not_found');
  const today = store.clock();
  const sub = { id: store.nextId('sub'), customerId, planId, status: 'active', periodStart: today, periodEnd: addDays(today, PERIOD_DAYS), pending: [] };
  store.subscriptions.set(sub.id, sub);
  record(store, 'subscribe', sub.id);
  return ok(view(sub));
}

export function getSubscription(store, id) {
  const sub = store.subscriptions.get(id);
  return sub ? ok(view(sub)) : fail('not_found');
}

export function changePlan(store, id, planId) {
  const sub = store.subscriptions.get(id);
  if (!sub) return fail('not_found');
  if (sub.status !== 'active') return fail('cancelled');
  const next = store.plans.get(planId);
  if (!next) return fail('not_found');
  if (planId === sub.planId) return fail('invalid');
  const left = daysBetween(store.clock(), sub.periodEnd);
  const credit = owedBack(store.plans.get(sub.planId).priceCents, left);
  const charge = charged(next.priceCents, left);
  sub.pending.push({ kind: 'credit', amountCents: -credit }, { kind: 'charge', amountCents: charge });
  sub.planId = planId;
  record(store, 'changePlan', id);
  return ok({ credit, charge });
}

export function cancel(store, id, { immediate = false } = {}) {
  const sub = store.subscriptions.get(id);
  if (!sub) return fail('not_found');
  if (sub.status !== 'active') return fail('cancelled');
  const today = store.clock();
  if (immediate) {
    const refund = owedBack(store.plans.get(sub.planId).priceCents, daysBetween(today, sub.periodEnd));
    sub.pending.push({ kind: 'refund', amountCents: -refund });
    sub.status = 'cancelled';
    sub.endsOn = today;
  } else {
    sub.status = 'cancelling';
    sub.endsOn = sub.periodEnd;
  }
  record(store, 'cancel', id);
  return ok(view(sub));
}

export function closePeriod(store, id) {
  const sub = store.subscriptions.get(id);
  if (!sub) return fail('not_found');
  const active = sub.status === 'active';
  if (!active && sub.pending.length === 0) return fail('cancelled');
  const lines = [...sub.pending.map((l) => ({ ...l })), ...(active ? [{ kind: 'plan', amountCents: store.plans.get(sub.planId).priceCents }] : [])];
  const invoice = { id: store.nextId('inv'), subscriptionId: id, periodStart: sub.periodStart, periodEnd: sub.periodEnd, lines, totalCents: lines.reduce((s, l) => s + l.amountCents, 0) };
  store.invoices.push(invoice);
  sub.pending = [];
  if (active) {
    sub.periodStart = sub.periodEnd;
    sub.periodEnd = addDays(sub.periodEnd, PERIOD_DAYS);
  } else sub.status = 'cancelled';
  record(store, 'closePeriod', id);
  return ok({ ...invoice, lines: invoice.lines.map((l) => ({ ...l })) });
}
