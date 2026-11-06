// SOMI-CANARY-H5-6c2e9a41d7b3f085
// Tax: taken out of the price where it is included, added per category group where it is not.
import { PricingError } from './errors.mjs';

export function requireRates(lines, card) {
  for (const l of lines) {
    if (card.tax[l.category] === undefined) throw new PricingError('bad_item', 'unknown category ' + l.category);
  }
}

const shape = (l, tax, round) => ({ sku: l.sku, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, discount: round(l.disc), net: l.now, tax });

// extra charges (shipping, handling) that carry tax in this country
const taxableCharges = (card, ship, handling) => (card.shipTax ? [ship, handling].filter((c) => c > 0) : []);

function taxIncluded(lines, card, ship, handling, round) {
  const rows = lines.map((l) => shape(l, round(l.now - l.now / (1 + card.tax[l.category])), round));
  let acc = 0;
  for (const row of rows) acc += row.tax;
  for (const c of taxableCharges(card, ship, handling)) acc += round(c - c / (1 + card.tax.general));
  return { tax: round(acc), lines: rows };
}

function taxAdded(lines, card, ship, handling, exempt, round) {
  const rows = lines.map((l) => shape(l, round(l.now * card.tax[l.category]), round));
  if (exempt) return { tax: 0, lines: rows };
  const groups = {};
  const order = [];
  for (const l of lines) {
    if (groups[l.category] === undefined) {
      groups[l.category] = 0;
      order.push(l.category);
    }
    groups[l.category] += l.now;
  }
  let acc = 0;
  for (const cat of order) acc += round(round(groups[cat]) * card.tax[cat]);
  for (const c of taxableCharges(card, ship, handling)) acc += round(c * card.tax.general);
  return { tax: round(acc), lines: rows };
}

export function taxFor({ lines, card, ship, handling, exempt, round }) {
  return card.inc ? taxIncluded(lines, card, ship, handling, round) : taxAdded(lines, card, ship, handling, exempt, round);
}
