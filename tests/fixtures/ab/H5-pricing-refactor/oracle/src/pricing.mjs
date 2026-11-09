// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Checkout pricing: turns a cart into a quote. This file only coordinates the steps; the rules live in
// rounding.mjs, discounts.mjs, shipping.mjs and tax.mjs. Finance signs off on the numbers, treat every digit as a contract.
import { PricingError } from './errors.mjs';
import { couponCodes, applyDiscounts } from './discounts.mjs';
import { decimalsFor, roundTo } from './rounding.mjs';
import { handlingFor, methodOf, ratesFor, shippingFor } from './shipping.mjs';
import { checkCategories, taxFor } from './tax.mjs';

export { PricingError, couponCodes };
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];

function checkCart(cart) {
  if (!cart || typeof cart !== 'object' || !Array.isArray(cart.items) || cart.items.length === 0) {
    throw new PricingError('empty_cart', 'the cart has no items');
  }
  if (cart.items.length > 40) throw new PricingError('too_many_lines', 'a cart holds at most 40 lines');
  for (let i = 0; i < cart.items.length; i++) {
    const it = cart.items[i];
    if (!it || typeof it !== 'object') throw new PricingError('bad_item', 'item ' + i + ' is not an object');
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 99) throw new PricingError('bad_item', 'item ' + i + ' has a bad quantity');
    if (typeof it.unitPrice !== 'number' || !Number.isFinite(it.unitPrice) || it.unitPrice < 0) {
      throw new PricingError('bad_item', 'item ' + i + ' has a bad price');
    }
  }
  if (!SUPPORTED_CURRENCIES.includes(cart.currency)) throw new PricingError('unknown_currency', 'unsupported currency ' + cart.currency);
}

// working copies of the lines: the caller's cart is never touched
function workingLines(items, round) {
  return items.map((it) => {
    const total = round(it.unitPrice * it.qty);
    return { sku: it.sku, qty: it.qty, unitPrice: it.unitPrice, category: it.category || 'general', weight: it.weight || 0.5, lineTotal: total, now: total, disc: 0 };
  });
}

export function quote(cart) {
  checkCart(cart);
  const currency = cart.currency;
  const decimals = decimalsFor(currency);
  const round = (x) => roundTo(x, decimals);
  const customer = cart.customer || {};

  const lines = workingLines(cart.items, round);
  let sum = 0;
  for (const l of lines) sum += l.lineTotal;
  const subtotal = round(sum);
  const { applied, rejected, freeShip, merch, discount } = applyDiscounts(lines, {
    subtotal, tier: customer.tier || 'standard', coupons: cart.coupons, date: cart.date, currency, round,
  });

  const country = ratesFor(customer.country);
  const method = methodOf(cart);
  const shipping = shippingFor({ lines, country, method, merch, freeShip, currency, decimals });
  const handling = handlingFor({ lines, country, method, merch, decimals });
  checkCategories(lines, country);
  const { tax, lines: outLines } = taxFor({ lines, country, ship: shipping, handling, exempt: customer.taxExempt === true, decimals });
  const total = country.inc ? round(merch + shipping + handling) : round(merch + shipping + handling + tax);

  return {
    currency, lines: outLines, subtotal, discount, shipping, handling, tax, taxIncluded: country.inc, total,
    appliedCoupons: applied, rejectedCoupons: rejected,
  };
}
