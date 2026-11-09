// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Shipping and handling charges. Both are rounded through fixedTo, unlike the other amounts.
import { COUNTRY } from './countries.mjs';
import { PricingError } from './errors.mjs';
import { fixedTo } from './rounding.mjs';

const METHODS = ['standard', 'express', 'pickup'];

/** Rate card of a country; 'US' when none is given. */
export function ratesFor(countryCode) {
  const country = COUNTRY[countryCode || 'US'];
  if (!country) throw new PricingError('unknown_country', 'no rates for country ' + countryCode);
  return country;
}

/** The shipping method of a cart, 'standard' when none is given. */
export function methodOf(cart) {
  const method = (cart.shipping && cart.shipping.method) || 'standard';
  if (!METHODS.includes(method)) throw new PricingError('bad_shipping', 'unknown shipping method ' + method);
  return method;
}

/** Whether nothing in the order is physical (downloads only). */
export function onlyDigital(lines) {
  return lines.every((l) => l.category === 'digital');
}

function weightKg(lines) {
  let kg = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].category !== 'digital') kg += lines[i].weight * lines[i].qty;
  }
  return kg;
}

/** Shipping charge for the order: country rates, method, what the goods weigh and what they are worth after discounts. */
export function shippingFor({ lines, country, method, merch, freeShip, currency, decimals }) {
  if (method === 'pickup' || onlyDigital(lines)) return 0;
  const steps = Math.ceil(weightKg(lines) * 2) / 2;
  const rate = method === 'express' ? country.exp : country.std;
  let ship = fixedTo(rate[0] + rate[1] * steps, decimals);
  if (merch >= country.free) ship = method === 'standard' ? 0 : fixedTo(ship * 0.5, decimals);
  if (freeShip) {
    if (method === 'standard') ship = 0;
    else {
      ship = ship - (currency === 'JPY' ? 500 : 5);
      if (ship < 0) ship = 0;
      ship = fixedTo(ship, decimals);
    }
  }
  return ship;
}

/** Handling fee for small orders (not when collected, not for downloads). */
export function handlingFor({ lines, country, method, merch, decimals }) {
  if (method === 'pickup' || onlyDigital(lines) || !(merch < country.small)) return 0;
  return fixedTo(country.fee, decimals);
}
