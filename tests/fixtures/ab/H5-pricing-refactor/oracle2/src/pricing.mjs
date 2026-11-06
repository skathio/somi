// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Checkout pricing entry point: turns a cart into a quote by running the steps in order.
import { CURRENCIES, check, sumOf, workingLines } from './cart.mjs';
import { applyCoupons, couponCodes, memberDiscount, quantityDiscount } from './discounts.mjs';
import { PricingError } from './errors.mjs';
import { digitsOf, roundFor } from './rounding.mjs';
import { handlingFee, methodFor, rateCard, shippingCharge } from './shipping.mjs';
import { requireRates, taxFor } from './tax.mjs';

export { PricingError, couponCodes };
export const SUPPORTED_CURRENCIES = CURRENCIES.slice();

export function quote(cart) {
  check(cart);
  const { currency } = cart;
  const digits = digitsOf(currency);
  const round = roundFor(currency);
  const customer = cart.customer || {};
  const tier = customer.tier || 'standard';

  const base = workingLines(cart.items, round);
  const subtotal = round(sumOf(base.map((l) => l.lineTotal)));
  const priced = memberDiscount(quantityDiscount(base, round), tier, round);
  const deals = applyCoupons(priced, { coupons: cart.coupons, date: cart.date, tier, subtotal, currency, round });
  const lines = deals.lines;
  const merch = round(sumOf(lines.map((l) => l.now)));

  const card = rateCard(customer.country);
  const method = methodFor(cart);
  const shipping = shippingCharge({ lines, card, method, merch, freeShip: deals.freeShip, currency, digits });
  const handling = handlingFee({ lines, card, method, merch, digits });
  requireRates(lines, card);
  const taxed = taxFor({ lines, card, ship: shipping, handling, exempt: customer.taxExempt === true, round });
  const payable = card.inc ? merch + shipping + handling : merch + shipping + handling + taxed.tax;

  return {
    currency,
    lines: taxed.lines,
    subtotal,
    discount: round(subtotal - merch),
    shipping,
    handling,
    tax: taxed.tax,
    taxIncluded: card.inc,
    total: round(payable),
    appliedCoupons: deals.applied,
    rejectedCoupons: deals.rejected,
  };
}
