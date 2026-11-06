// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Quantity, member and coupon discounts. Works on the working lines built by pricing.mjs (never on the caller's cart):
// each line has lineTotal (before discounts), now (what it is worth so far) and disc (what was taken off so far).

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

function worth(lines, round) {
  let running = 0;
  for (let i = 0; i < lines.length; i++) running += lines[i].now;
  return round(running);
}

function bulkDiscount(lines, round) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.category === 'digital') continue;
    for (let b = 0; b < BULK.length; b++) {
      if (l.qty >= BULK[b][0]) {
        const d = round(l.lineTotal * BULK[b][1] / 100);
        l.now = round(l.lineTotal - d);
        l.disc = d;
        break;
      }
    }
  }
}

function memberDiscount(lines, tier, round) {
  const pct = TIER[tier] === undefined ? 0 : TIER[tier];
  if (!(pct > 0)) return;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = round(l.lineTotal * pct / 100);
    l.now = round(l.now - d);
    l.disc = l.disc + d;
  }
}

// up to three known, distinct codes in the order typed
function pickCoupons(typed, rejected) {
  const picked = {};
  let seenKnown = 0;
  const list = Array.isArray(typed) ? typed : [];
  for (let i = 0; i < list.length; i++) {
    const code = String(list[i]).trim().toUpperCase();
    if (!COUPONS[code]) rejected.push({ code, reason: 'unknown' });
    else if (picked[code]) rejected.push({ code, reason: 'duplicate' });
    else if (seenKnown >= 3) rejected.push({ code, reason: 'limit' });
    else {
      seenKnown++;
      picked[code] = true;
    }
  }
  return picked;
}

function takePercent(lines, c, round) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (c.only && l.category !== c.only) continue;
    const d = round(l.now * c.value / 100);
    l.now = round(l.now - d);
    l.disc = l.disc + d;
  }
}

// spread over the lines in proportion to what they are worth now; the last line takes what is left
function takeFixed(lines, amount, running, round) {
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].now > 0) last = i;
  let given = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.now <= 0) continue;
    const share = i === last ? round(amount - given) : round(amount * l.now / running);
    given += share;
    l.now = round(l.now - share);
    l.disc = l.disc + share;
  }
}

/**
 * Applies bulk, member and coupon discounts to `lines` in place.
 * Returns { applied, rejected, freeShip, merch, discount } where merch is what the lines are worth afterwards.
 */
export function applyDiscounts(lines, { subtotal, tier, coupons, date, currency, round }) {
  bulkDiscount(lines, round);
  memberDiscount(lines, tier, round);
  const rejected = [];
  const picked = pickCoupons(coupons, rejected);
  const applied = [];
  let freeShip = false;
  let percentOrder = false;
  for (let k = 0; k < COUPON_ORDER.length; k++) {
    const code = COUPON_ORDER[k];
    if (!picked[code]) continue;
    const c = COUPONS[code];
    const running = worth(lines, round);
    let why = null;
    if (c.until && typeof date === 'string' && date > c.until) why = 'expired';
    else if (c.tier && c.tier !== tier) why = 'tier';
    else if (code === 'SAVE10' && percentOrder) why = 'excluded';
    else if (c.kind === 'percent' && subtotal < c.min) why = 'min_subtotal';
    else if (c.kind === 'fixed' && (c.after ? running : subtotal) < c.min) why = 'min_subtotal';
    else if (c.kind === 'ship' && running < c.min) why = 'min_subtotal';
    if (why) {
      rejected.push({ code, reason: why });
      continue;
    }
    if (c.kind === 'percent') {
      takePercent(lines, c, round);
      if (code === 'SAVE20') percentOrder = true;
    } else if (c.kind === 'fixed') {
      const wanted = c.value * (currency === 'JPY' ? 100 : 1);
      takeFixed(lines, wanted > running ? running : wanted, running, round);
    } else freeShip = true;
    applied.push(code);
  }
  const merch = worth(lines, round);
  return { applied, rejected, freeShip, merch, discount: round(subtotal - merch) };
}
