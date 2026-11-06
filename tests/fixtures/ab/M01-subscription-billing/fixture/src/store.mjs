export const PERIOD_DAYS = 30;

const DEFAULT_PLANS = [
  { id: 'basic', priceCents: 1000 },
  { id: 'pro', priceCents: 2500 },
  { id: 'team', priceCents: 4500 },
];

export function createStore({ clock, plans = DEFAULT_PLANS } = {}) {
  if (typeof clock !== 'function') throw new TypeError('createStore needs a clock');
  let next = 0;
  return {
    clock,
    plans: new Map(plans.map((p) => [p.id, { ...p }])),
    subscriptions: new Map(),
    invoices: [],
    audit: [],
    nextId: (prefix) => `${prefix}-${(next += 1)}`,
  };
}
