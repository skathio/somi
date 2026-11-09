// SOMI-CANARY-H5-6c2e9a41d7b3f085
// The generated carts the hidden suite replays: a seeded generator, so the set is the same on every run and every machine.
// golden.json holds what the fixture's original quote() answered for each of them (regenerate with gen-golden.mjs).

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRY_CURRENCY = { US: 'USD', CA: 'USD', DE: 'EUR', FR: 'EUR', GB: 'GBP', JP: 'JPY' };
const PRICES = [0.99, 1.005, 1.015, 2.675, 4.35, 9.99, 12.5, 19.99, 24.95, 33.335, 0.1, 0.2, 7.125, 15.5, 45, 120.45, 199.99, 3.333, 10.075, 0.285, 8.875, 59.9, 5.45, 0.07];
const YEN = [80, 120, 199, 250, 480, 980, 1200, 1980, 3333, 4500, 12800];
const QTYS = [1, 1, 1, 2, 2, 3, 5, 9, 10, 12, 24, 25, 30, 99];
const CATS = ['general', 'general', 'book', 'food', 'digital'];
const SHIP = ['standard', 'standard', 'express', 'pickup'];
const COUPON_POOL = ['SAVE10', 'SAVE20', 'BOOKS15', 'GOLD5', 'FIVEOFF', 'TENOFF', 'WELCOME', 'FREESHIP'];

function build() {
  const R = prng(20250314);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const chance = (p) => R() < p;
  const cents = () => int(1, 20000) / 100;
  const item = (o = {}) => {
    const jpy = o.currency === 'JPY';
    const x = { sku: 'sku' + int(100, 999), qty: pick(QTYS), unitPrice: jpy ? pick(YEN) : chance(0.35) ? cents() : pick(PRICES), category: pick(CATS) };
    if (chance(0.25)) x.weight = pick([0.2, 1, 2.5, 0, 0.75]);
    return { ...x, ...o.item };
  };
  const items = (n, o) => Array.from({ length: n }, () => item(o));
  const code = (c) => (chance(0.2) ? c.toLowerCase() : chance(0.1) ? ' ' + c + ' ' : c);
  const coupons = (n) => Array.from({ length: n }, () => code(chance(0.1) ? pick(['NOPE', 'save', 'SAVE30']) : pick(COUPON_POOL)));
  const cart = (country, o = {}) => {
    const currency = o.currency ?? (chance(0.08) ? pick(['USD', 'EUR', 'GBP']) : COUNTRY_CURRENCY[country]);
    const c = { currency, customer: { country, tier: o.tier ?? pick(['standard', 'standard', 'silver', 'gold']) }, items: items(o.n ?? int(1, 4), { currency }), shipping: { method: o.method ?? pick(SHIP) } };
    if (o.coupons) c.coupons = o.coupons;
    if (o.date) c.date = o.date;
    return c;
  };
  const make = (prefix, n, build) => Array.from({ length: n }, (_, i) => ({ id: prefix + '-' + String(i + 1).padStart(3, '0'), cart: build(i) }));
  const lit = (prefix, list) => list.map((cart, i) => ({ id: prefix + '-' + String(i + 1).padStart(3, '0'), cart }));
  const one = (price, o = {}) => ({ currency: 'USD', customer: { country: 'US', tier: 'standard' }, items: [{ sku: 'k', qty: 1, unitPrice: price, category: 'general', weight: 1 }], shipping: { method: 'standard' }, ...o });
  const groups = [];
  const add = (name, title, carts) => groups.push({ name, title, carts });

  add('plain', 'tax added on top (US, CA), no discounts', make('plain', 70, () => cart(pick(['US', 'CA']), { tier: 'standard' })));
  add('vat', 'tax included in the price (DE, FR, GB, JP)', make('vat', 70, () => cart(pick(['DE', 'FR', 'GB', 'JP']), { tier: 'standard' })));
  add('members', 'member tiers and quantity discounts', make('members', 60, (i) => cart(pick(['US', 'DE', 'GB', 'CA', 'JP']), { tier: pick(['silver', 'gold']), n: int(1, 3), method: 'standard' })));
  add('stacking', 'coupons: stacking, order typed, limits, duplicates', [
    ...make('stack', 70, () => cart(pick(['US', 'DE', 'CA', 'GB', 'JP']), { coupons: coupons(int(1, 5)) })),
    ...lit('stack-fixed', [
      one(120, { coupons: ['SAVE10', 'SAVE20'] }), one(120, { coupons: ['SAVE20', 'SAVE10'] }), one(90, { coupons: ['SAVE20', 'SAVE10'] }),
      one(100, { coupons: ['SAVE20'] }), one(99.99, { coupons: ['SAVE20', 'SAVE10'] }),
      one(80, { coupons: ['TENOFF', 'FIVEOFF', 'SAVE10'] }), one(80, { coupons: ['SAVE10', 'FIVEOFF', 'TENOFF'] }),
      one(80, { coupons: ['SAVE10', 'FIVEOFF', 'TENOFF', 'WELCOME'] }), one(80, { coupons: ['FIVEOFF', 'save10', ' tenoff ', 'SAVE10', 'FIVEOFF'] }),
      one(80, { coupons: ['NOPE', 'SAVE10', 'NOPE', 'TENOFF', 'FIVEOFF', 'WELCOME'] }),
      one(80, { coupons: 'SAVE10' }), one(80, { coupons: null }), one(80, { coupons: [] }), one(80, { coupons: [10, null, 'SAVE10'] }),
      one(60, { customer: { country: 'US', tier: 'gold' }, coupons: ['GOLD5', 'SAVE10', 'FIVEOFF'] }),
      one(60, { customer: { country: 'US', tier: 'silver' }, coupons: ['GOLD5', 'SAVE10'] }),
    ]),
  ]);
  add('eligibility', 'coupons: thresholds, expiry, tier', [
    ...lit('elig-min', [29.99, 30, 30.01, 33.33, 33.34, 33.35, 49.99, 50, 50.01, 24.99, 25, 19.99, 20, 99.99, 100, 100.01].flatMap((p) => [one(p, { coupons: ['FIVEOFF'] }), one(p, { coupons: ['SAVE10', 'FIVEOFF'] }), one(p, { coupons: ['TENOFF', 'WELCOME', 'FREESHIP'] }), one(p, { coupons: ['SAVE20', 'FREESHIP'] })])),
    ...lit('elig-date', ['2025-06-29', '2025-06-30', '2025-07-01', undefined, 20250101, '', '2026-01-01'].map((d) => one(40, { coupons: ['WELCOME', 'SAVE10'], date: d }))),
  ]);
  add('shipping', 'shipping charges, thresholds, weights, free shipping', [
    ...make('ship', 60, () => cart(pick(['US', 'CA', 'DE', 'FR', 'GB', 'JP']), { n: int(1, 3), coupons: chance(0.3) ? ['FREESHIP'] : undefined })),
    ...lit('ship-free', ['US', 'CA', 'DE', 'FR', 'GB'].flatMap((c) => [[74.99, 'standard'], [75, 'standard'], [75, 'express'], [60, 'express'], [49.99, 'express'], [100, 'express'], [20, 'pickup']].map(([p, m]) => one(p, { customer: { country: c, tier: 'standard' }, shipping: { method: m } })))),
    ...lit('ship-misc', [
      one(10, { items: [{ sku: 'd', qty: 2, unitPrice: 5, category: 'digital', weight: 3 }] }),
      one(10, { items: [{ sku: 'd', qty: 2, unitPrice: 5, category: 'digital' }, { sku: 'g', qty: 1, unitPrice: 5, category: 'general' }] }),
      one(10, { items: [{ sku: 'a', qty: 1, unitPrice: 5, category: 'general', weight: 0 }] }),
      one(10, { items: [{ sku: 'a', qty: 3, unitPrice: 5, category: 'general', weight: 0 }, { sku: 'b', qty: 1, unitPrice: 5, category: 'general', weight: 0.01 }] }),
      one(10, { items: [{ sku: 'a', qty: 2, unitPrice: 5, category: 'general', weight: 0.74 }] }), one(10, { items: [{ sku: 'a', qty: 1, unitPrice: 5, category: 'general', weight: 0.75 }] }),
      one(10, { items: [{ sku: 'a', qty: 1, unitPrice: 5, category: 'general', weight: 0.76 }] }), one(10, { items: [{ sku: 'a', qty: 1, unitPrice: 5, category: 'general', weight: 7.31 }] }),
      one(10, { items: [{ sku: 'a', qty: 1, unitPrice: 5 }] }), one(10, { shipping: undefined }), one(10, { shipping: {} }),
      one(14.99, {}), one(15, {}), one(15.01, {}), one(9.99, { shipping: { method: 'express' } }), one(9.99, { shipping: { method: 'pickup' } }),
      one(10, { coupons: ['FREESHIP'], shipping: { method: 'express' } }), one(80, { coupons: ['FREESHIP'], shipping: { method: 'express' } }),
      one(30, { coupons: ['FREESHIP'], shipping: { method: 'express' }, customer: { country: 'DE', tier: 'standard' }, currency: 'EUR' }),
      one(30, { coupons: ['FREESHIP'], shipping: { method: 'express' }, customer: { country: 'JP', tier: 'standard' }, currency: 'JPY' }),
    ]),
  ]);
  add('jpy', 'yen carts (no minor unit)', make('jpy', 50, () => cart(pick(['JP', 'JP', 'US', 'DE']), { currency: 'JPY', coupons: chance(0.5) ? coupons(int(1, 3)) : undefined })));
  add('float', 'prices and rates that do not round the way they read', [
    ...make('float', 60, () => cart(pick(['US', 'CA', 'DE', 'FR', 'GB']), { n: int(2, 6), coupons: chance(0.5) ? coupons(int(1, 3)) : undefined, method: pick(['standard', 'express']) })).map((e) => {
      e.cart.items.forEach((x, i) => { x.unitPrice = pick([1.005, 1.015, 2.675, 4.35, 8.875, 0.285, 10.075, 33.335, 0.07, 1.115, 1.255, 5.015, 7.005]); x.qty = pick([1, 3, 7, 9, 11]); });
      return e;
    }),
    ...lit('float-sum', [one(0.1, { items: [0.1, 0.2, 0.3, 0.1, 0.2].map((p, i) => ({ sku: 's' + i, qty: 1, unitPrice: p, category: 'general' })) }), one(0, { items: [1.1, 2.2, 3.3].map((p, i) => ({ sku: 's' + i, qty: 3, unitPrice: p, category: 'book' })) }), one(0, { items: [0.07, 0.07, 0.07].map((p, i) => ({ sku: 's' + i, qty: 99, unitPrice: p, category: 'food' })) })]),
    // found by a search: float sums of several lines of one category that only come out right when the group is rounded first
    ...lit('float-noise', [
      {"currency":"USD","customer":{"country":"CA","tier":"silver"},"shipping":{"method":"express"},"items":[{"sku":"s","qty":3,"unitPrice":1.79,"category":"book"},{"sku":"s","qty":4,"unitPrice":9.55,"category":"book"}]},
      {"currency":"USD","customer":{"country":"CA","tier":"silver"},"shipping":{"method":"pickup"},"items":[{"sku":"s","qty":2,"unitPrice":5.13,"category":"book"},{"sku":"s","qty":2,"unitPrice":2.3,"category":"general"},{"sku":"s","qty":3,"unitPrice":22.37,"category":"book"},{"sku":"s","qty":1,"unitPrice":21.21,"category":"general"},{"sku":"s","qty":3,"unitPrice":20.34,"category":"book"}]},
      {"currency":"USD","customer":{"country":"CA","tier":"silver"},"shipping":{"method":"express"},"items":[{"sku":"s","qty":4,"unitPrice":8.33,"category":"book"},{"sku":"s","qty":2,"unitPrice":9.68,"category":"general"},{"sku":"s","qty":4,"unitPrice":16.85,"category":"book"},{"sku":"s","qty":3,"unitPrice":17.62,"category":"general"}]},
      {"currency":"USD","customer":{"country":"CA","tier":"standard"},"shipping":{"method":"standard"},"items":[{"sku":"s","qty":4,"unitPrice":18.63,"category":"book"},{"sku":"s","qty":2,"unitPrice":20.57,"category":"general"},{"sku":"s","qty":2,"unitPrice":9.19,"category":"book"}]},
      {"currency":"USD","customer":{"country":"CA","tier":"standard"},"shipping":{"method":"pickup"},"items":[{"sku":"s","qty":3,"unitPrice":9.1,"category":"general"},{"sku":"s","qty":1,"unitPrice":1.94,"category":"general"},{"sku":"s","qty":3,"unitPrice":15.35,"category":"general"},{"sku":"s","qty":1,"unitPrice":2.48,"category":"book"},{"sku":"s","qty":2,"unitPrice":24.31,"category":"book"}]},
      {"currency":"USD","customer":{"country":"CA","tier":"standard"},"shipping":{"method":"standard"},"items":[{"sku":"s","qty":3,"unitPrice":14.67,"category":"book"},{"sku":"s","qty":3,"unitPrice":23.51,"category":"book"},{"sku":"s","qty":1,"unitPrice":28.85,"category":"general"},{"sku":"s","qty":3,"unitPrice":23.12,"category":"book"},{"sku":"s","qty":1,"unitPrice":12.05,"category":"general"}]},
    ]),
    ...lit('float-big', [one(0, { items: [{ sku: 'b', qty: 99, unitPrice: 99999.99, category: 'general' }] }), one(0, { items: [{ sku: 'b', qty: 1, unitPrice: 0, category: 'general' }] }), one(0, { items: [{ sku: 'b', qty: 1, unitPrice: 0.004, category: 'general' }, { sku: 'c', qty: 1, unitPrice: 0.005, category: 'general' }] }), one(0, { items: [{ sku: 'b', qty: 2, unitPrice: 1e-7, category: 'general' }] })]),
  ]);
  add('mixed', 'mixed categories, exempt customers and odd but accepted input', [
    ...make('mix', 40, () => cart(pick(['US', 'CA', 'DE', 'FR', 'JP']), { n: int(3, 6), coupons: chance(0.5) ? coupons(int(1, 3)) : undefined })),
    ...lit('mix-misc', [
      one(50, { customer: { country: 'US', tier: 'standard', taxExempt: true } }), one(50, { customer: { country: 'CA', taxExempt: true }, shipping: { method: 'express' } }),
      one(50, { customer: { country: 'DE', taxExempt: true }, currency: 'EUR' }), one(50, { customer: { country: 'US', taxExempt: 'yes' } }), one(50, { customer: { country: 'US', tier: 'platinum' } }),
      one(50, { customer: undefined }), one(50, { customer: {} }), one(50, { customer: { tier: 'gold' } }), one(50, { shipping: { method: 'standard', extra: 1 }, note: 'gift', extra: { a: 1 } }),
      one(50, { items: [{ sku: 'x', qty: 1, unitPrice: 20, category: 'food' }, { sku: 'y', qty: 2, unitPrice: 12.34, category: 'book' }, { sku: 'z', qty: 1, unitPrice: 7.77, category: 'food' }, { sku: 'w', qty: 3, unitPrice: 1.99 }] }),
      one(50, { items: [{ sku: 'x', qty: 10, unitPrice: 20, category: 'digital' }, { sku: 'y', qty: 10, unitPrice: 20, category: 'book' }] }),
      one(50, { items: [{ sku: 'x', qty: 1, unitPrice: 20 }, { sku: 'x', qty: 1, unitPrice: 20 }], coupons: ['BOOKS15'] }),
      one(50, { items: [{ sku: 'x', qty: 2, unitPrice: 0, category: 'general' }, { sku: 'y', qty: 1, unitPrice: 9, category: 'general' }], coupons: ['TENOFF', 'FIVEOFF', 'WELCOME'] }),
      one(50, { items: [{ sku: 'x', qty: 2, unitPrice: 0, category: 'general' }], coupons: ['SAVE10', 'FIVEOFF'] }),
      one(8, { coupons: ['WELCOME'] }), one(21, { coupons: ['WELCOME', 'WELCOME'] }), one(20, { coupons: ['WELCOME'], customer: { country: 'US', tier: 'gold' } }),
      // empty or missing values that stand for "not given"
      ...['', null, 0].map((category) => one(10, { items: [{ sku: 'a', qty: 1, unitPrice: 10, category }] })),
      ...['', 0].map((country) => one(10, { customer: { country, tier: 'standard' } })),
      one(10, { customer: { country: '', tier: '' }, shipping: { method: '' } }),
    ]),
  ]);
  const bad = (change) => { const c = one(40); return change(c) ?? c; };
  add('errors', 'carts that are refused (which check fires first)', lit('err', [
    null, undefined, 'cart', 5, {}, { items: [] }, { items: 'x' }, { currency: 'USD', items: {} },
    bad((c) => { c.items = []; }), bad((c) => { c.items = Array.from({ length: 41 }, () => ({ sku: 'q', qty: 1, unitPrice: 1 })); }),
    bad((c) => { c.items = Array.from({ length: 40 }, () => ({ sku: 'q', qty: 1, unitPrice: 1 })); }),
    bad((c) => { c.items[0].qty = 0; }), bad((c) => { c.items[0].qty = 100; }), bad((c) => { c.items[0].qty = 1.5; }), bad((c) => { c.items[0].qty = '2'; }), bad((c) => { c.items[0].qty = undefined; }),
    bad((c) => { c.items[0].unitPrice = -1; }), bad((c) => { c.items[0].unitPrice = '4'; }), bad((c) => { c.items[0].unitPrice = NaN; }), bad((c) => { c.items[0].unitPrice = Infinity; }), bad((c) => { c.items[0].unitPrice = undefined; }),
    bad((c) => { c.items.push(null); }), bad((c) => { c.items.push('x'); }), bad((c) => { c.items = [{ sku: 'a', qty: 1, unitPrice: 1 }, { sku: 'b', qty: 0, unitPrice: -1 }, { sku: 'c', qty: 0, unitPrice: 1 }]; }),
    bad((c) => { c.items[0].qty = 0; c.currency = 'XXX'; }), bad((c) => { c.currency = 'XXX'; c.customer.country = 'ZZ'; }), bad((c) => { c.currency = 'usd'; }), bad((c) => { c.currency = undefined; }),
    bad((c) => { c.customer.country = 'ZZ'; c.shipping.method = 'drone'; }), bad((c) => { c.customer.country = 'ZZ'; c.items[0].category = 'weapons'; }),
    bad((c) => { c.shipping.method = 'drone'; c.items[0].category = 'weapons'; }), bad((c) => { c.shipping.method = 'drone'; }), bad((c) => { c.shipping.method = 'Standard'; }), bad((c) => { c.shipping.method = ''; }),
    bad((c) => { c.items[0].category = 'weapons'; }), bad((c) => { c.items[0].category = 'Book'; }), bad((c) => { c.customer.country = 'us'; }), bad((c) => { c.customer.country = null; }),
    bad((c) => { c.shipping.method = 'pickup'; c.items[0].category = 'weapons'; }), bad((c) => { c.items[0].category = 'weapons'; c.coupons = ['SAVE10']; }),
  ]));
  // Not pooled: a category that is the name of something every object already has. Obscure, so it is scored apart.
  const cat = (name, more = {}) => one(40, { items: [{ sku: 'a', qty: 1, unitPrice: 1, category: name }, { sku: 'b', qty: 2, unitPrice: 3.5, category: 'book' }], ...more });
  const extra = [{ name: 'inherited', title: 'a category that is the name of something every object has', carts: lit('inh', [
    cat('toString'), cat('__proto__'), cat('constructor'), cat('hasOwnProperty'), cat('toString', { customer: { country: 'DE', tier: 'standard' }, currency: 'EUR' }),
  ]) }];
  return { groups, extra };
}
export const buildGroups = () => build().groups;
export const buildExtra = () => build().extra;

// What one call answered, as plain JSON data in which -0, NaN and the infinities survive (JSON would turn them into 0 or null).
const mark = (_k, v) => (typeof v !== 'number' ? v : Object.is(v, -0) ? '-0' : Number.isFinite(v) ? v : String(v));
export function record(mod, cart) {
  try {
    return JSON.parse(JSON.stringify({ ok: mod.quote(cart) }, mark));
  } catch (e) {
    const pricing = typeof mod.PricingError === 'function' && e instanceof mod.PricingError;
    return { error: pricing ? { pricing, name: e.name, code: e.code, message: e.message } : { pricing, name: e?.constructor?.name } };
  }
}
