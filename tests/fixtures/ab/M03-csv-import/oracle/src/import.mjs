// SOMI-CANARY-M03-522283907fe02c13
import { fail, ok } from './result.mjs';

const MAX_BYTES = 65536;
const MAX_ROWS = 1000;
const SKU = /^[A-Z0-9-]{1,32}$/;
const PRICE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const STOCK = /^\d{1,9}$/;

// RFC 4180 records. A quoted field may hold commas, line breaks and doubled quotes. A final line break ends the last record.
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(record); record = []; };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i += 1; continue; }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === '') { quoted = true; i += 1; continue; }
    if (c === ',') { endField(); i += 1; continue; }
    if (c === '\r' && text[i + 1] === '\n') { endRecord(); i += 2; continue; }
    if (c === '\n') { endRecord(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

// Exact: the digits are read as text, so 0.29 is 29 cents and not 28.
export function toCents(text) {
  const m = PRICE.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function rowProblem([sku, name, price, stock]) {
  if (!SKU.test(sku)) return 'invalid_sku';
  if (name.length < 1 || name.length > 200) return 'invalid_name';
  if (toCents(price) === null) return 'invalid_price';
  if (stock !== '' && !STOCK.test(stock)) return 'invalid_stock';
  return null;
}

export function importCsv(store, text) {
  if (typeof text !== 'string') return fail('invalid');
  if (Buffer.byteLength(text) > MAX_BYTES) return fail('too_large');
  const records = parseCsv(text);
  if (records.length - 1 > MAX_ROWS) return fail('too_large');
  if (records.length === 0 || records[0].join(',') !== 'sku,name,price,stock') return fail('invalid_header');
  const rows = [];
  const seen = new Set();
  const good = [];
  records.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (r.length !== 4) { rows.push({ line, code: 'invalid_row' }); return; }
    const problem = rowProblem(r);
    if (problem) { rows.push({ line, code: problem }); return; }
    if (seen.has(r[0])) { rows.push({ line, code: 'duplicate' }); return; }
    seen.add(r[0]);
    good.push({ sku: r[0], name: r[1], priceCents: toCents(r[2]), stock: r[3] === '' ? null : Number(r[3]) });
  });
  if (rows.length > 0) return fail('invalid_rows', { rows });
  let added = 0;
  let updated = 0;
  for (const p of good) {
    if (store.products.has(p.sku)) updated += 1; else added += 1;
    store.products.set(p.sku, { ...p });
  }
  return ok({ added, updated });
}
