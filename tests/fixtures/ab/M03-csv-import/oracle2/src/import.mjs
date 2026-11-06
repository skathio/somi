// SOMI-CANARY-M03-522283907fe02c13
import { fail, ok } from './result.mjs';

function* records(text) {
  let fields = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i <= text.length; i += 1) {
    const c = i < text.length ? text[i] : null;
    if (inQuotes) {
      if (c === null) { break; }
      if (c === '"') { if (text[i + 1] === '"') { buf += '"'; i += 1; } else inQuotes = false; } else buf += c;
      continue;
    }
    if (c === '"' && buf.length === 0) inQuotes = true;
    else if (c === ',') { fields.push(buf); buf = ''; }
    else if (c === '\n' || c === null || (c === '\r' && text[i + 1] === '\n')) {
      if (c === '\r') i += 1;
      if (c !== null || buf !== '' || fields.length > 0) { fields.push(buf); yield fields; }
      fields = []; buf = '';
    } else buf += c;
  }
}

const cents = (s) => {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
};
const check = (sku, name, price, stock) => (!/^[A-Z0-9-]{1,32}$/.test(sku) ? 'invalid_sku' : !(name.length >= 1 && name.length <= 200) ? 'invalid_name' : cents(price) === null ? 'invalid_price' : stock !== '' && !/^\d{1,9}$/.test(stock) ? 'invalid_stock' : null);

export function importCsv(store, text) {
  if (typeof text !== 'string') return fail('invalid');
  if (new TextEncoder().encode(text).length > 65536) return fail('too_large');
  const all = [...records(text)];
  if (all.length > 1001) return fail('too_large');
  const [header, ...body] = all;
  if (!header || header.length !== 4 || header[0] !== 'sku' || header[1] !== 'name' || header[2] !== 'price' || header[3] !== 'stock') return fail('invalid_header');
  const refused = [];
  const accepted = new Map();
  body.forEach((r, n) => {
    const line = n + 2;
    const code = r.length !== 4 ? 'invalid_row' : check(...r) ?? (accepted.has(r[0]) ? 'duplicate' : null);
    if (code) refused.push({ line, code });
    else accepted.set(r[0], { sku: r[0], name: r[1], priceCents: cents(r[2]), stock: r[3] === '' ? null : parseInt(r[3], 10) });
  });
  if (refused.length) return fail('invalid_rows', { rows: refused });
  const counts = { added: 0, updated: 0 };
  for (const [sku, p] of accepted) { counts[store.products.has(sku) ? 'updated' : 'added'] += 1; store.products.set(sku, p); }
  return ok(counts);
}
