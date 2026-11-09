// SOMI-CANARY-H1-4d7e1b92c0a85f36
// CSV export of the orders matching the list filters, all of them, in list order.
import { parseFilters } from './validate.mjs';
import { listOrders } from './store.mjs';

const COLUMNS = ['id', 'created_at', 'customer', 'status', 'total', 'currency'];
const PAGE = 25;
const SPREADSHEET_FORMULA_START = /^[=+\-@\t\r]/;

// Integer cents as a decimal amount with two places, sign kept.
export function decimal(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// One CSV cell; free text that a spreadsheet could read as a formula gets a leading apostrophe.
export function cell(value, { text = false } = {}) {
  let s = String(value);
  if (text && SPREADSHEET_FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function allMatching(filters) {
  const out = [];
  let after = null;
  do {
    const page = listOrders(filters, { limit: PAGE, after });
    out.push(...page.items);
    after = page.next;
  } while (after);
  return out;
}

export function exportCsv(url) {
  const orders = allMatching(parseFilters(url.searchParams));
  const lines = [COLUMNS.join(',')];
  for (const o of orders) {
    lines.push([cell(o.id), cell(o.created_at), cell(o.customer, { text: true }), cell(o.status), decimal(o.total_cents), cell(o.currency)].join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportHandler(req, res, params, url) {
  const body = Buffer.from(exportCsv(url), 'utf8');
  const day = new Date().toISOString().slice(0, 10);
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="orders-${day}.csv"`,
    'content-length': body.length,
  });
  res.end(body);
}
