// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Shipping charge and small-order handling fee.
import { PricingError } from './errors.mjs';
import { viaString } from './rounding.mjs';
import { COUNTRIES } from './tables.mjs';

export function rateCard(code) {
  const card = COUNTRIES[code || 'US'];
  if (!card) throw new PricingError('unknown_country', 'no rates for country ' + code);
  return card;
}

export function methodFor(cart) {
  const m = (cart.shipping && cart.shipping.method) || 'standard';
  if (m !== 'standard' && m !== 'express' && m !== 'pickup') throw new PricingError('bad_shipping', 'unknown shipping method ' + m);
  return m;
}

const physical = (lines) => lines.filter((l) => l.category !== 'digital');

export function shippingCharge({ lines, card, method, merch, freeShip, currency, digits }) {
  const parcel = physical(lines);
  if (method === 'pickup' || parcel.length === 0) return 0;
  const kg = parcel.reduce((acc, l) => acc + l.weight * l.qty, 0);
  const [base, perKg] = method === 'express' ? card.exp : card.std;
  let charge = viaString(base + perKg * (Math.ceil(kg * 2) / 2), digits);
  if (merch >= card.free) charge = method === 'standard' ? 0 : viaString(charge * 0.5, digits);
  if (!freeShip) return charge;
  if (method === 'standard') return 0;
  const reduced = charge - (currency === 'JPY' ? 500 : 5);
  return viaString(reduced < 0 ? 0 : reduced, digits);
}

export function handlingFee({ lines, card, method, merch, digits }) {
  const applies = method !== 'pickup' && physical(lines).length > 0 && merch < card.small;
  return applies ? viaString(card.fee, digits) : 0;
}
