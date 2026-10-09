// Checkout pricing: turns a cart into a quote. Grown over several years; the README lists the rules it implements.
// Finance signs off on the numbers this file produces, so treat every digit as a contract.

export class PricingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];

// per country: is the shelf price tax-inclusive, tax rate per category, is shipping taxed, free-shipping threshold,
// [base, per kg] for standard and express, and the small-order limit with its handling fee
const COUNTRY = {
  US: { inc: false, tax: { general: 0.0725, book: 0.0725, digital: 0.0725, food: 0 }, shipTax: false, free: 75, std: [4.99, 1.2], exp: [14.99, 2.5], small: 15, fee: 1.5 },
  CA: { inc: false, tax: { general: 0.05, book: 0.05, digital: 0.05, food: 0 }, shipTax: true, free: 100, std: [9.5, 1.9], exp: [22, 3.1], small: 20, fee: 2 },
  DE: { inc: true, tax: { general: 0.19, book: 0.07, digital: 0.19, food: 0.07 }, shipTax: true, free: 60, std: [5.9, 0.9], exp: [16.9, 2.2], small: 10, fee: 1.2 },
  FR: { inc: true, tax: { general: 0.2, book: 0.055, digital: 0.2, food: 0.055 }, shipTax: true, free: 60, std: [6.4, 1.1], exp: [17.5, 2.4], small: 10, fee: 1.2 },
  GB: { inc: true, tax: { general: 0.2, book: 0, digital: 0.2, food: 0 }, shipTax: true, free: 50, std: [3.95, 0.8], exp: [12.95, 1.85], small: 10, fee: 1 },
  JP: { inc: true, tax: { general: 0.1, book: 0.1, digital: 0.1, food: 0.08 }, shipTax: true, free: 8000, std: [550, 90], exp: [1200, 240], small: 1500, fee: 150 },
};

const BULK = [[25, 6], [10, 3]]; // [quantity from, percent off the line], best match first

const TIER = { standard: 0, silver: 2, gold: 5 };

const COUPONS = {
  SAVE10: { kind: 'percent', value: 10, min: 0 },
  SAVE20: { kind: 'percent', value: 20, min: 100 },
  BOOKS15: { kind: 'percent', value: 15, min: 0, only: 'book' },
  GOLD5: { kind: 'percent', value: 5, min: 0, tier: 'gold' },
  FIVEOFF: { kind: 'fixed', value: 5, min: 30, after: true },
  TENOFF: { kind: 'fixed', value: 10, min: 50 },
  WELCOME: { kind: 'fixed', value: 8, min: 20, until: '2025-06-30' },
  FREESHIP: { kind: 'ship', min: 25 },
};

// the order the coupons are applied in, whatever order the customer typed them
const COUPON_ORDER = ['SAVE20', 'SAVE10', 'GOLD5', 'BOOKS15', 'TENOFF', 'FIVEOFF', 'WELCOME', 'FREESHIP'];

export function couponCodes() {
  return Object.keys(COUPONS).sort();
}

export function quote(cart) {
  // ---- checks
  if (!cart || typeof cart !== 'object' || !Array.isArray(cart.items) || cart.items.length === 0) {
    throw new PricingError('empty_cart', 'the cart has no items');
  }
  if (cart.items.length > 40) throw new PricingError('too_many_lines', 'a cart holds at most 40 lines');
  for (let i = 0; i < cart.items.length; i++) {
    const it = cart.items[i];
    if (!it || typeof it !== 'object') throw new PricingError('bad_item', 'item ' + i + ' is not an object');
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 99) {
      throw new PricingError('bad_item', 'item ' + i + ' has a bad quantity');
    }
    if (typeof it.unitPrice !== 'number' || !Number.isFinite(it.unitPrice) || it.unitPrice < 0) {
      throw new PricingError('bad_item', 'item ' + i + ' has a bad price');
    }
  }
  const cur = cart.currency;
  if (SUPPORTED_CURRENCIES.indexOf(cur) < 0) throw new PricingError('unknown_currency', 'unsupported currency ' + cur);
  // JPY has no minor unit: everything is rounded to whole yen, the rest to cents
  const dec = cur === 'JPY' ? 0 : 2;
  const f = dec === 0 ? 1 : 100;
  const r2 = (x) => Math.round(x * f) / f;
  const t2 = (x) => Number(x.toFixed(dec));

  const customer = cart.customer || {};
  const tier = customer.tier || 'standard';
  const memberPct = TIER[tier] === undefined ? 0 : TIER[tier];

  // ---- lines
  const lines = [];
  let sum = 0;
  for (let i = 0; i < cart.items.length; i++) {
    const it = cart.items[i];
    const total = r2(it.unitPrice * it.qty);
    sum += total;
    lines.push({
      sku: it.sku,
      qty: it.qty,
      unitPrice: it.unitPrice,
      category: it.category || 'general',
      weight: it.weight || 0.5,
      lineTotal: total,
      now: total,
      disc: 0,
    });
  }
  const subtotal = r2(sum);

  // ---- bulk discount, per line (not on downloads)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.category === 'digital') continue;
    for (let b = 0; b < BULK.length; b++) {
      if (l.qty >= BULK[b][0]) {
        const d = r2(l.lineTotal * BULK[b][1] / 100);
        l.now = r2(l.lineTotal - d);
        l.disc = d;
        break;
      }
    }
  }

  // ---- member discount, per line
  if (memberPct > 0) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const d = r2(l.lineTotal * memberPct / 100);
      l.now = r2(l.now - d);
      l.disc = l.disc + d;
    }
  }

  // ---- coupons: pick up to three known, distinct codes in the order typed
  const rejected = [];
  const picked = {};
  let seenKnown = 0;
  const typed = Array.isArray(cart.coupons) ? cart.coupons : [];
  for (let i = 0; i < typed.length; i++) {
    const code = String(typed[i]).trim().toUpperCase();
    if (!COUPONS[code]) {
      rejected.push({ code, reason: 'unknown' });
      continue;
    }
    if (picked[code]) {
      rejected.push({ code, reason: 'duplicate' });
      continue;
    }
    if (seenKnown >= 3) {
      rejected.push({ code, reason: 'limit' });
      continue;
    }
    seenKnown++;
    picked[code] = true;
  }

  // ---- coupons: apply in fixed order
  const applied = [];
  let freeShip = false;
  let percentOrder = false;
  for (let k = 0; k < COUPON_ORDER.length; k++) {
    const code = COUPON_ORDER[k];
    if (!picked[code]) continue;
    const c = COUPONS[code];
    if (c.until && typeof cart.date === 'string' && cart.date > c.until) {
      rejected.push({ code, reason: 'expired' });
      continue;
    }
    if (c.tier && c.tier !== tier) {
      rejected.push({ code, reason: 'tier' });
      continue;
    }
    if (code === 'SAVE10' && percentOrder) {
      rejected.push({ code, reason: 'excluded' });
      continue;
    }
    let running = 0;
    for (let i = 0; i < lines.length; i++) running += lines[i].now;
    running = r2(running);
    if (c.kind === 'percent') {
      if (subtotal < c.min) {
        rejected.push({ code, reason: 'min_subtotal' });
        continue;
      }
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (c.only && l.category !== c.only) continue;
        const d = r2(l.now * c.value / 100);
        l.now = r2(l.now - d);
        l.disc = l.disc + d;
      }
      if (code === 'SAVE20') percentOrder = true;
      applied.push(code);
    } else if (c.kind === 'fixed') {
      const basis = c.after ? running : subtotal;
      if (basis < c.min) {
        rejected.push({ code, reason: 'min_subtotal' });
        continue;
      }
      let amount = c.value * (cur === 'JPY' ? 100 : 1);
      if (amount > running) amount = running;
      // spread over the lines in proportion to what they are worth now; the last line takes what is left
      let last = -1;
      for (let i = 0; i < lines.length; i++) if (lines[i].now > 0) last = i;
      let given = 0;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.now <= 0) continue;
        let share;
        if (i === last) share = r2(amount - given);
        else share = r2(amount * l.now / running);
        given += share;
        l.now = r2(l.now - share);
        l.disc = l.disc + share;
      }
      applied.push(code);
    } else {
      if (running < c.min) {
        rejected.push({ code, reason: 'min_subtotal' });
        continue;
      }
      freeShip = true;
      applied.push(code);
    }
  }

  let merch = 0;
  for (let i = 0; i < lines.length; i++) merch += lines[i].now;
  merch = r2(merch);
  const discount = r2(subtotal - merch);

  // ---- shipping
  const country = COUNTRY[customer.country || 'US'];
  if (!country) throw new PricingError('unknown_country', 'no rates for country ' + customer.country);
  const method = (cart.shipping && cart.shipping.method) || 'standard';
  if (method !== 'standard' && method !== 'express' && method !== 'pickup') {
    throw new PricingError('bad_shipping', 'unknown shipping method ' + method);
  }
  let ship = 0;
  let allDigital = true;
  let kg = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].category !== 'digital') {
      allDigital = false;
      kg += lines[i].weight * lines[i].qty;
    }
  }
  if (method !== 'pickup' && !allDigital) {
    const steps = Math.ceil(kg * 2) / 2;
    const rate = method === 'express' ? country.exp : country.std;
    ship = t2(rate[0] + rate[1] * steps);
    if (merch >= country.free) {
      if (method === 'standard') ship = 0;
      else ship = t2(ship * 0.5);
    }
    if (freeShip) {
      if (method === 'standard') ship = 0;
      else {
        ship = ship - (cur === 'JPY' ? 500 : 5);
        if (ship < 0) ship = 0;
        ship = t2(ship);
      }
    }
  }

  // small orders pay a handling fee (not when collected, not for downloads)
  let handling = 0;
  if (method !== 'pickup' && !allDigital && merch < country.small) handling = t2(country.fee);

  // ---- tax
  let tax = 0;
  const outLines = [];
  const rates = country.tax;
  for (let i = 0; i < lines.length; i++) {
    if (rates[lines[i].category] === undefined) {
      throw new PricingError('bad_item', 'unknown category ' + lines[i].category);
    }
  }
  if (country.inc) {
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const rate = rates[l.category];
      const t = r2(l.now - l.now / (1 + rate));
      acc += t;
      outLines.push({ sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, discount: r2(l.disc), net: l.now, tax: t });
    }
    if (country.shipTax && ship > 0) {
      acc += r2(ship - ship / (1 + rates.general));
    }
    if (country.shipTax && handling > 0) {
      acc += r2(handling - handling / (1 + rates.general));
    }
    tax = r2(acc);
  } else {
    const groups = {};
    const order = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (groups[l.category] === undefined) {
        groups[l.category] = 0;
        order.push(l.category);
      }
      groups[l.category] += l.now;
      outLines.push({ sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, discount: r2(l.disc), net: l.now, tax: r2(l.now * rates[l.category]) });
    }
    if (customer.taxExempt !== true) {
      let acc = 0;
      for (let i = 0; i < order.length; i++) {
        acc += r2(r2(groups[order[i]]) * rates[order[i]]);
      }
      if (country.shipTax && ship > 0) acc += r2(ship * rates.general);
      if (country.shipTax && handling > 0) acc += r2(handling * rates.general);
      tax = r2(acc);
    }
  }

  // ---- total
  let total;
  if (country.inc) total = r2(merch + ship + handling);
  else total = r2(merch + ship + handling + tax);

  return {
    currency: cur,
    lines: outLines,
    subtotal,
    discount,
    shipping: ship,
    handling,
    tax,
    taxIncluded: country.inc,
    total,
    appliedCoupons: applied,
    rejectedCoupons: rejected,
  };
}
