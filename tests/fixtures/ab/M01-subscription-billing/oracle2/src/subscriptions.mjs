// SOMI-CANARY-M01-749043d973a32ba5
import { addDays, daysBetween } from './dates.mjs';
import { prorated } from './prorate.mjs';
import { fail, ok } from './result.mjs';
import { PERIOD_DAYS } from './store.mjs';

const copy = (sub) => JSON.parse(JSON.stringify(sub));
const log = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };
const find = (store, id) => store.subscriptions.get(id) ?? null;
const price = (store, planId) => store.plans.get(planId).priceCents;

export function subscribe(store, { customerId, planId } = {}) {
  if (typeof customerId !== 'string' || customerId === '') return fail('invalid');
  if (!store.plans.has(planId)) return fail('not_found');
  const start = store.clock();
  const sub = { id: store.nextId('sub'), customerId, planId, status: 'active', periodStart: start, periodEnd: addDays(start, PERIOD_DAYS), pending: [] };
  store.subscriptions.set(sub.id, sub);
  log(store, 'subscribe', sub.id);
  return ok(copy(sub));
}

export const getSubscription = (store, id) => (find(store, id) ? ok(copy(find(store, id))) : fail('not_found'));

export function changePlan(store, id, planId) {
  const sub = find(store, id);
  if (sub === null) return fail('not_found');
  if (sub.status !== 'active') return fail('cancelled');
  if (!store.plans.has(planId)) return fail('not_found');
  if (sub.planId === planId) return fail('invalid');
  const days = daysBetween(store.clock(), sub.periodEnd);
  const credit = prorated(price(store, sub.planId), days, 'owed');
  const charge = prorated(price(store, planId), days, 'charged');
  sub.pending = [...sub.pending, { kind: 'credit', amountCents: -credit }, { kind: 'charge', amountCents: charge }];
  sub.planId = planId;
  log(store, 'changePlan', id);
  return ok({ credit, charge });
}

export function cancel(store, id, options = {}) {
  const sub = find(store, id);
  if (sub === null) return fail('not_found');
  if (sub.status !== 'active') return fail('cancelled');
  const today = store.clock();
  if (options.immediate === true) {
    sub.pending = [...sub.pending, { kind: 'refund', amountCents: -prorated(price(store, sub.planId), daysBetween(today, sub.periodEnd), 'owed') }];
    Object.assign(sub, { status: 'cancelled', endsOn: today });
  } else Object.assign(sub, { status: 'cancelling', endsOn: sub.periodEnd });
  log(store, 'cancel', id);
  return ok(copy(sub));
}

export function closePeriod(store, id) {
  const sub = find(store, id);
  if (sub === null) return fail('not_found');
  const over = sub.status !== 'active';
  if (over && sub.pending.length === 0) return fail('cancelled');
  const lines = over ? sub.pending : [...sub.pending, { kind: 'plan', amountCents: price(store, sub.planId) }];
  const invoice = copy({ id: store.nextId('inv'), subscriptionId: id, periodStart: sub.periodStart, periodEnd: sub.periodEnd, lines, totalCents: lines.reduce((s, l) => s + l.amountCents, 0) });
  store.invoices.push(invoice);
  if (over) Object.assign(sub, { status: 'cancelled', pending: [] });
  else Object.assign(sub, { periodStart: sub.periodEnd, periodEnd: addDays(sub.periodEnd, PERIOD_DAYS), pending: [] });
  log(store, 'closePeriod', id);
  return ok(copy(invoice));
}
