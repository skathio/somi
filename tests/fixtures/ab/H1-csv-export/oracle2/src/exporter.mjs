// SOMI-CANARY-H1-4d7e1b92c0a85f36
// Streams the export page by page, with its own CSV writer and its own cents formatter.
import { fromError } from './http.mjs';
import { parseDate, parseStatus } from './validate.mjs';
import { listOrders } from './store.mjs';

const HEADER = ['id', 'created_at', 'customer', 'status', 'total', 'currency'];

// BigInt division keeps every digit exact, whatever the size.
function money(cents) {
  const n = BigInt(cents);
  const abs = n < 0n ? -n : n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${n < 0n ? '-' : ''}${abs / 100n}.${frac}`;
}

function field(text, untrusted) {
  const chars = [...String(text)];
  if (untrusted && chars.length && '=+-@\t\r'.includes(chars[0])) chars.unshift('\t');
  const raw = chars.join('');
  const needsQuotes = [...raw].some((c) => c === ',' || c === '"' || c === '\n' || c === '\r');
  return needsQuotes ? `"${[...raw].map((c) => (c === '"' ? '""' : c)).join('')}"` : raw;
}

const row = (cells) => `${cells.join(',')}\r\n`;

export function streamExport(res, params) {
  try {
    const filters = { status: parseStatus(params.get('status')), from: parseDate(params.get('from'), 'from'), to: parseDate(params.get('to'), 'to') };
    const stamp = new Date().toISOString().replace(/T.*/, '');
    res.writeHead(200, {
      'Content-Type': 'text/csv;charset=UTF-8',
      'Content-Disposition': `attachment; filename=orders-${stamp}.csv`,
    });
    res.write(Buffer.from([0xef, 0xbb, 0xbf]));
    res.write(row(HEADER));
    for (let after = null, more = true; more;) {
      const page = listOrders(filters, { limit: 100, after });
      for (const o of page.items) res.write(row([field(o.id), field(o.created_at), field(o.customer, true), field(o.status), money(o.total_cents), field(o.currency)]));
      after = page.next;
      more = after !== null;
    }
    res.end();
  } catch (err) {
    fromError(res, err);
  }
}
