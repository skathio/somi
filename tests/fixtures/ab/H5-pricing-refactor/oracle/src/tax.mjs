// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Tax. Where the shelf price already includes tax the tax is taken out of each line; elsewhere it is added on top,
// per category group.
import { PricingError } from './errors.mjs';
import { roundTo } from './rounding.mjs';

/** Throws for a line whose category the country has no rate for. */
export function checkCategories(lines, country) {
  const rates = country.tax;
  for (let i = 0; i < lines.length; i++) {
    if (rates[lines[i].category] === undefined) throw new PricingError('bad_item', 'unknown category ' + lines[i].category);
  }
}

function lineOut(l, tax, r) {
  return { sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, discount: r(l.disc), net: l.now, tax };
}

function included({ lines, country, ship, handling, r }) {
  const rates = country.tax;
  let acc = 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = r(l.now - l.now / (1 + rates[l.category]));
    acc += t;
    out.push(lineOut(l, t, r));
  }
  if (country.shipTax && ship > 0) acc += r(ship - ship / (1 + rates.general));
  if (country.shipTax && handling > 0) acc += r(handling - handling / (1 + rates.general));
  return { tax: r(acc), lines: out };
}

function added({ lines, country, ship, handling, exempt, r }) {
  const rates = country.tax;
  const groups = {};
  const order = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (groups[l.category] === undefined) {
      groups[l.category] = 0;
      order.push(l.category);
    }
    groups[l.category] += l.now;
    out.push(lineOut(l, r(l.now * rates[l.category]), r));
  }
  if (exempt) return { tax: 0, lines: out };
  let acc = 0;
  for (let i = 0; i < order.length; i++) acc += r(r(groups[order[i]]) * rates[order[i]]);
  if (country.shipTax && ship > 0) acc += r(ship * rates.general);
  if (country.shipTax && handling > 0) acc += r(handling * rates.general);
  return { tax: r(acc), lines: out };
}

/** { tax, lines } for the order: the tax total and the quote lines with their own tax. */
export function taxFor({ lines, country, ship, handling, exempt, decimals }) {
  const r = (x) => roundTo(x, decimals);
  const args = { lines, country, ship, handling, exempt, r };
  return country.inc ? included(args) : added(args);
}
