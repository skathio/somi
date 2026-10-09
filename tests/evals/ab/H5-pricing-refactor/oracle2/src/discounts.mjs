// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Discounts as a pipeline over immutable lines: quantity, then member, then coupons.
import { sumOf } from './cart.mjs';
import { BULK, COUPONS, COUPON_ORDER, TIERS } from './tables.mjs';

export const couponCodes = () => Object.keys(COUPONS).sort();

const take = (line, amount, round) => ({ ...line, now: round(line.now - amount), disc: line.disc + amount });

export function quantityDiscount(lines, round) {
  return lines.map((l) => {
    const band = l.category === 'digital' ? undefined : BULK.find(([from]) => l.qty >= from);
    if (!band) return l;
    const off = round(l.lineTotal * band[1] / 100);
    return { ...l, now: round(l.lineTotal - off), disc: off };
  });
}

export function memberDiscount(lines, tier, round) {
  const pct = TIERS[tier] === undefined ? 0 : TIERS[tier];
  return pct > 0 ? lines.map((l) => take(l, round(l.lineTotal * pct / 100), round)) : lines;
}

// the codes that count: known, not repeated, and no more than three
export function chooseCoupons(typed) {
  const chosen = new Set();
  const rejected = [];
  let known = 0;
  for (const raw of Array.isArray(typed) ? typed : []) {
    const code = String(raw).trim().toUpperCase();
    const why = !COUPONS[code] ? 'unknown' : chosen.has(code) ? 'duplicate' : known >= 3 ? 'limit' : null;
    if (why) rejected.push({ code, reason: why });
    else {
      known += 1;
      chosen.add(code);
    }
  }
  return { chosen, rejected };
}

const worth = (lines, round) => round(sumOf(lines.map((l) => l.now)));

function percentOff(lines, c, round) {
  return lines.map((l) => (c.only && l.category !== c.only ? l : take(l, round(l.now * c.value / 100), round)));
}

function fixedOff(lines, amount, total, round) {
  const last = lines.reduce((at, l, i) => (l.now > 0 ? i : at), -1);
  let given = 0;
  return lines.map((l, i) => {
    if (l.now <= 0) return l;
    const share = i === last ? round(amount - given) : round(amount * l.now / total);
    given += share;
    return take(l, share, round);
  });
}

// why a coupon cannot be used right now, or null
function refusal(code, c, s, ctx) {
  if (c.until && typeof ctx.date === 'string' && ctx.date > c.until) return 'expired';
  if (c.tier && c.tier !== ctx.tier) return 'tier';
  if (code === 'SAVE10' && s.exclusive) return 'excluded';
  const basis = c.kind === 'percent' ? ctx.subtotal : c.kind === 'fixed' ? (c.after ? s.total : ctx.subtotal) : s.total;
  return basis < c.min ? 'min_subtotal' : null;
}

export function applyCoupons(lines, ctx) {
  const { chosen, rejected } = chooseCoupons(ctx.coupons);
  let s = { lines, applied: [], rejected, freeShip: false, exclusive: false, total: 0 };
  for (const code of COUPON_ORDER.filter((k) => chosen.has(k))) {
    const c = COUPONS[code];
    s = { ...s, total: worth(s.lines, ctx.round) };
    const why = refusal(code, c, s, ctx);
    if (why) {
      s = { ...s, rejected: [...s.rejected, { code, reason: why }] };
      continue;
    }
    const wanted = c.kind === 'fixed' ? c.value * (ctx.currency === 'JPY' ? 100 : 1) : 0;
    const next = c.kind === 'percent' ? percentOff(s.lines, c, ctx.round) : c.kind === 'fixed' ? fixedOff(s.lines, wanted > s.total ? s.total : wanted, s.total, ctx.round) : s.lines;
    s = { ...s, lines: next, applied: [...s.applied, code], freeShip: s.freeShip || c.kind === 'ship', exclusive: s.exclusive || code === 'SAVE20' };
  }
  return s;
}
