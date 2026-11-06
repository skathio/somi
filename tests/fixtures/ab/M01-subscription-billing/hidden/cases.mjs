// SOMI-CANARY-M01-749043d973a32ba5
const world = async (load, start = '2031-01-01') => {
  const { createStore } = await load('src/store.mjs');
  const subs = await load('src/subscriptions.mjs');
  let today = start;
  const store = createStore({ clock: () => today });
  return { store, subs, on: (day) => { today = day; } };
};
const started = async (load, planId = 'basic', start) => {
  const w = await world(load, start);
  return { ...w, id: w.subs.subscribe(w.store, { customerId: 'c1', planId }).value.id };
};
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const invoiceView = (r) => (r.ok ? { ok: true, value: { ...pick(r.value, ['subscriptionId', 'periodStart', 'periodEnd', 'lines', 'totalCents']), id: typeof r.value.id } } : r);
const changed = async (load, from, to, day) => { const w = await started(load, from); w.on(day); return { ...w, r: w.subs.changePlan(w.store, w.id, to) }; };

export const cases = [
  { name: 'AC2 [regression] subscribe starts an active 30-day period today', run: async (load) => pick((await started(load)).subs.getSubscription((await started(load)).store, 'sub-1').value, ['status', 'periodStart', 'periodEnd']), expect: { status: 'active', periodStart: '2031-01-01', periodEnd: '2031-01-31' } },
  { name: 'AC2 [regression] subscribe writes one audit entry', run: async (load) => (await started(load)).store.audit, expect: [{ type: 'subscribe', at: '2031-01-01', id: 'sub-1' }] },
  { name: 'AC4 [regression] an unknown plan has code not_found', run: async (load) => { const w = await world(load); return w.subs.subscribe(w.store, { customerId: 'c1', planId: 'gold' }); }, expect: { ok: false, error: { code: 'not_found' } } },
  { name: 'AC3 [regression] periods are counted in UTC days from the store clock across a month end', run: async (load) => pick((await started(load, 'basic', '2031-02-15')).subs.getSubscription((await started(load, 'basic', '2031-02-15')).store, 'sub-1').value, ['periodStart', 'periodEnd']), expect: { periodStart: '2031-02-15', periodEnd: '2031-03-17' } },
  { name: 'AC5 [functional] an upgrade credits the unused days and charges the rest in the customer favour', run: async (load) => (await changed(load, 'basic', 'pro', '2031-01-11')).r, expect: { ok: true, value: { credit: 667, charge: 1666 } } },
  { name: 'AC5 [functional] a downgrade is prorated the same way', run: async (load) => (await changed(load, 'pro', 'basic', '2031-01-11')).r, expect: { ok: true, value: { credit: 1667, charge: 666 } } },
  { name: 'AC5 [boundary] a change on the first day prorates the whole period', run: async (load) => (await changed(load, 'basic', 'pro', '2031-01-01')).r, expect: { ok: true, value: { credit: 1000, charge: 2500 } } },
  { name: 'AC5 [boundary] a change on the last day prorates one day', run: async (load) => (await changed(load, 'basic', 'pro', '2031-01-30')).r, expect: { ok: true, value: { credit: 34, charge: 83 } } },
  { name: 'AC5 [functional] the new plan applies at once and the period stays where it was', run: async (load) => { const w = await changed(load, 'basic', 'pro', '2031-01-11'); return pick(w.subs.getSubscription(w.store, w.id).value, ['planId', 'periodStart', 'periodEnd']); }, expect: { planId: 'pro', periodStart: '2031-01-01', periodEnd: '2031-01-31' } },
  { name: 'AC5 [functional] the credit and charge wait as pending lines', run: async (load) => { const w = await changed(load, 'basic', 'pro', '2031-01-11'); return w.subs.getSubscription(w.store, w.id).value.pending; }, expect: [{ kind: 'credit', amountCents: -667 }, { kind: 'charge', amountCents: 1666 }] },
  { name: 'AC4 [functional] an unknown subscription has code not_found', run: async (load) => { const w = await started(load); return w.subs.changePlan(w.store, 'sub-99', 'pro'); }, expect: { ok: false, error: { code: 'not_found' } } },
  { name: 'AC4 [functional] an unknown plan to change to has code not_found', run: async (load) => (await changed(load, 'basic', 'gold', '2031-01-11')).r, expect: { ok: false, error: { code: 'not_found' } } },
  { name: 'AC5 [functional] changing to the same plan has code invalid', run: async (load) => (await changed(load, 'basic', 'basic', '2031-01-11')).r, expect: { ok: false, error: { code: 'invalid' } } },
  { name: 'AC2 [functional] a plan change appends one audit entry dated by the store clock', run: async (load) => (await changed(load, 'basic', 'pro', '2031-01-11')).store.audit.at(-1), expect: { type: 'changePlan', at: '2031-01-11', id: 'sub-1' } },
  { name: 'AC2 [functional] a failed operation appends nothing to the audit', run: async (load) => { const w = await changed(load, 'basic', 'gold', '2031-01-11'); w.subs.cancel(w.store, 'sub-99'); return w.store.audit.length; }, expect: 1 },
  { name: 'AC7 [functional] a cancel runs to the end of the period by default', run: async (load) => { const w = await started(load); w.on('2031-01-21'); return pick(w.subs.cancel(w.store, w.id).value, ['status', 'endsOn', 'pending']); }, expect: { status: 'cancelling', endsOn: '2031-01-31', pending: [] } },
  { name: 'AC7 [functional] an immediate cancel ends today and refunds the unused days in the customer favour', run: async (load) => { const w = await started(load); w.on('2031-01-21'); return pick(w.subs.cancel(w.store, w.id, { immediate: true }).value, ['status', 'endsOn', 'pending']); }, expect: { status: 'cancelled', endsOn: '2031-01-21', pending: [{ kind: 'refund', amountCents: -334 }] } },
  { name: 'AC7 [functional] cancelling twice has code cancelled', run: async (load) => { const w = await started(load); w.subs.cancel(w.store, w.id); return w.subs.cancel(w.store, w.id, { immediate: true }); }, expect: { ok: false, error: { code: 'cancelled' } } },
  { name: 'AC7 [functional] a cancelled subscription cannot change plan', run: async (load) => { const w = await started(load); w.subs.cancel(w.store, w.id); return w.subs.changePlan(w.store, w.id, 'pro'); }, expect: { ok: false, error: { code: 'cancelled' } } },
  { name: 'AC2 [functional] a cancel appends one audit entry', run: async (load) => { const w = await started(load); w.on('2031-01-05'); w.subs.cancel(w.store, w.id); return w.store.audit.at(-1); }, expect: { type: 'cancel', at: '2031-01-05', id: 'sub-1' } },
  { name: 'AC8 [functional] closing a period bills its pending lines, then the plan for the next period', run: async (load) => { const w = await changed(load, 'basic', 'pro', '2031-01-11'); w.on('2031-01-31'); return invoiceView(w.subs.closePeriod(w.store, w.id)); }, expect: { ok: true, value: { subscriptionId: 'sub-1', periodStart: '2031-01-01', periodEnd: '2031-01-31', lines: [{ kind: 'credit', amountCents: -667 }, { kind: 'charge', amountCents: 1666 }, { kind: 'plan', amountCents: 2500 }], totalCents: 3499, id: 'string' } } },
  { name: 'AC8 [functional] the next period starts where the old one ended, with nothing pending', run: async (load) => { const w = await changed(load, 'basic', 'pro', '2031-01-11'); w.subs.closePeriod(w.store, w.id); return pick(w.subs.getSubscription(w.store, w.id).value, ['periodStart', 'periodEnd', 'pending']); }, expect: { periodStart: '2031-01-31', periodEnd: '2031-03-02', pending: [] } },
  { name: 'AC8 [functional] a second close bills only the plan', run: async (load) => { const w = await changed(load, 'basic', 'pro', '2031-01-11'); w.subs.closePeriod(w.store, w.id); return invoiceView(w.subs.closePeriod(w.store, w.id)).value?.lines; }, expect: [{ kind: 'plan', amountCents: 2500 }] },
  { name: 'AC8 [functional] each invoice is kept in store.invoices', run: async (load) => { const w = await started(load); w.subs.closePeriod(w.store, w.id); w.subs.closePeriod(w.store, w.id); return w.store.invoices.map((i) => i.totalCents); }, expect: [1000, 1000] },
  { name: 'AC2 [functional] closing a period appends one audit entry', run: async (load) => { const w = await started(load); w.on('2031-01-31'); w.subs.closePeriod(w.store, w.id); return w.store.audit.at(-1); }, expect: { type: 'closePeriod', at: '2031-01-31', id: 'sub-1' } },
  { name: 'AC9 [functional] after an immediate cancel the last invoice holds only the refund', run: async (load) => { const w = await started(load); w.on('2031-01-21'); w.subs.cancel(w.store, w.id, { immediate: true }); return invoiceView(w.subs.closePeriod(w.store, w.id)).value; }, expect: { subscriptionId: 'sub-1', periodStart: '2031-01-01', periodEnd: '2031-01-31', lines: [{ kind: 'refund', amountCents: -334 }], totalCents: -334, id: 'string' } },
  { name: 'AC9 [functional] a cancelled subscription with nothing pending has code cancelled', run: async (load) => { const w = await started(load); w.on('2031-01-21'); w.subs.cancel(w.store, w.id, { immediate: true }); w.subs.closePeriod(w.store, w.id); return w.subs.closePeriod(w.store, w.id); }, expect: { ok: false, error: { code: 'cancelled' } } },
  { name: 'AC9 [functional] a subscription cancelling at period end gets no next period', run: async (load) => { const w = await started(load); w.subs.cancel(w.store, w.id); return [w.subs.closePeriod(w.store, w.id), w.store.invoices.length]; }, expect: [{ ok: false, error: { code: 'cancelled' } }, 0] },
  { name: 'AC4 [functional] closing an unknown subscription has code not_found', run: async (load) => { const w = await started(load); return w.subs.closePeriod(w.store, 'sub-99'); }, expect: { ok: false, error: { code: 'not_found' } } },
];
