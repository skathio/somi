// SOMI-CANARY-M03-522283907fe02c13
import { listProducts } from './catalog.mjs';

// A leading =, +, - or @ makes a spreadsheet run the cell, so such a name gets a single quote in front.
const defused = (text) => (/^[=+\-@]/.test(text) ? `'${text}` : text);
const cell = (text) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
const money = (cents) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export function exportCsv(store) {
  const lines = ['sku,name,price,stock'];
  for (const p of listProducts(store)) lines.push([cell(p.sku), cell(defused(p.name)), money(p.priceCents), p.stock === null ? '' : String(p.stock)].join(','));
  return `${lines.join('\n')}\n`;
}
