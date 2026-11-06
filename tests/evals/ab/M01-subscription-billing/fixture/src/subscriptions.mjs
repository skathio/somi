import { addDays } from './dates.mjs';
import { fail, ok } from './result.mjs';
import { PERIOD_DAYS } from './store.mjs';

const view = (sub) => ({ ...sub, pending: sub.pending.map((l) => ({ ...l })) });

export function subscribe(store, { customerId, planId } = {}) {
  if (typeof customerId !== 'string' || customerId === '') return fail('invalid');
  if (!store.plans.has(planId)) return fail('not_found');
  const today = store.clock();
  const sub = { id: store.nextId('sub'), customerId, planId, status: 'active', periodStart: today, periodEnd: addDays(today, PERIOD_DAYS), pending: [] };
  store.subscriptions.set(sub.id, sub);
  store.audit.push({ type: 'subscribe', at: today, id: sub.id });
  return ok(view(sub));
}

export function getSubscription(store, id) {
  const sub = store.subscriptions.get(id);
  return sub ? ok(view(sub)) : fail('not_found');
}
