// SOMI-CANARY-M03-522283907fe02c13
import { listProducts } from './catalog.mjs';

const RISKY = new Set(['=', '+', '-', '@']);
const field = (s) => { const v = String(s); return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r') ? '"' + v.split('"').join('""') + '"' : v; };

export function exportCsv(store) {
  const out = ['sku,name,price,stock'];
  for (const { sku, name, priceCents, stock } of listProducts(store)) {
    const safeName = RISKY.has(name[0]) ? "'" + name : name;
    const price = (priceCents / 100).toFixed(2);
    out.push(field(sku) + ',' + field(safeName) + ',' + price + ',' + (stock === null ? '' : stock));
  }
  return out.map((l) => l + '\n').join('');
}
