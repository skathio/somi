// SOMI-CANARY-H1-4d7e1b92c0a85f36
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

// The candidate's service runs in ONE child process (the harness-owned runner); every test talks to it over HTTP.
const nonce = randomUUID();
const WS = process.env.TASK_WORKSPACE;
const child = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), nonce], { cwd: WS, env: process.env, stdio: ['ignore', 'pipe', 'ignore'] });
const portPromise = new Promise((resolve) => {
  let seen = '';
  const timer = setTimeout(() => resolve(null), 10000);
  child.stdout.on('data', (d) => {
    seen += d;
    const m = new RegExp('H1:' + nonce + ':(\\d+|none)').exec(seen);
    if (m) { clearTimeout(timer); resolve(m[1] === 'none' ? null : Number(m[1])); }
  });
  child.on('exit', () => resolve(null));
  child.on('error', () => resolve(null));
});
const stop = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
after(stop);
process.on('exit', stop);

let exportHung = false; // once an export request times out, later export tests fail at once instead of waiting again
async function get(path, init = {}) {
  const port = await portPromise;
  assert.ok(port, 'the service did not start');
  const isExport = path.startsWith('/orders/export.csv');
  assert.ok(!(isExport && exportHung), 'an earlier export request timed out');
  try {
    const res = await fetch('http://127.0.0.1:' + port + path, { ...init, signal: AbortSignal.timeout(2000) });
    const bytes = Buffer.from(await res.arrayBuffer());
    return { res, bytes, text: bytes.toString('utf8') };
  } catch (e) {
    if (isExport) exportHung = true;
    throw e;
  }
}
const json = async (path, init) => { const r = await get(path, init); return { ...r, body: JSON.parse(r.text) }; };

// RFC 4180 reader: quoted cells, doubled quotes, line breaks inside quotes, CRLF or LF between rows.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const HEADER = ['id', 'created_at', 'customer', 'status', 'total', 'currency'];
async function listAll(query = '') {
  const out = [];
  let after = null;
  do {
    const { body } = await json('/orders?limit=100' + (query ? '&' + query : '') + (after ? '&after=' + after : ''));
    out.push(...body.items);
    after = body.next;
  } while (after);
  return out;
}
async function csv(query = '') {
  const r = await get('/orders/export.csv' + (query ? '?' + query : ''));
  assert.equal(r.res.status, 200, 'export status');
  const rows = parseCsv(r.text);
  return { ...r, rows, data: rows.slice(1) };
}
const money = (cents) => { const n = BigInt(cents); const a = n < 0n ? -n : n; return (n < 0n ? '-' : '') + a / 100n + '.' + String(a % 100n).padStart(2, '0'); };
const idsOf = (rows) => rows.map((r) => r[0]);
const SAME_FILTERS = ['status=paid', 'status=PAID', 'status=Shipped&from=2025-03-10', 'from=2025-03-01&to=2025-04-01', 'to=2025-03-01', 'from=2025-04-01T00:00:00Z&to=2025-04-01T06:00:00Z', 'status=refunded&to=2025-05-01'];
const BAD_FILTERS = ['from=yesterday', 'to=2025-13-45', 'from=2025-03-01T10:00:00'];

test('AC1 [functional] GET /orders/export.csv succeeds and answers with CSV', async () => {
  const { res, text } = await get('/orders/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/csv/i);
  assert.ok(text.length > 0);
});
test('AC2 [functional] the first row is the header with the columns in the stated order', async () => { assert.deepEqual((await csv()).rows[0], HEADER); });
test('AC2 [functional] every other row has the six columns', async () => { const { data } = await csv(); assert.ok(data.length > 0); for (const r of data) assert.equal(r.length, 6, r[0]); });
test('AC3 [boundary] all orders are exported, not just the first page of the list', async () => { const all = await listAll(); const { data } = await csv(); assert.ok(all.length > 20); assert.equal(data.length, all.length); });
test('AC3 [boundary] the paging parameters of the list do not apply', async () => { const all = await listAll(); for (const q of ['limit=2', 'limit=2&after=ord_005', 'after=ord_010']) assert.equal((await csv(q)).data.length, all.length, q); });
test('AC3 [functional] rows follow the list order, including orders with the same timestamp', async () => { const all = await listAll(); assert.deepEqual(idsOf((await csv()).data), all.map((o) => o.id)); });
test('AC4 [functional] the status, from and to filters select the same orders as the list', async () => { for (const q of SAME_FILTERS) assert.deepEqual(idsOf((await csv(q)).data), (await listAll(q)).map((o) => o.id), q); });
test('AC4 [boundary] from is inclusive and to is exclusive, as in the list', async () => {
  const at = (await listAll('from=2025-04-01&to=2025-04-02')).map((o) => o.id);
  assert.ok(at.length >= 2);
  assert.deepEqual(idsOf((await csv('from=2025-04-01&to=2025-04-02')).data), at);
  assert.deepEqual(idsOf((await csv('to=2025-04-01')).data).filter((id) => at.includes(id)), []);
});
test('AC4 [safety] an invalid status is rejected like the list rejects it', async () => { for (const q of ['status=bogus', 'status=']) { const l = await json('/orders?' + q); const e = await json('/orders/export.csv?' + q); assert.equal(e.res.status, l.res.status, q); assert.equal(e.body.error.code, l.body.error.code, q); assert.deepEqual(Object.keys(e.body), ['error']); assert.deepEqual(Object.keys(e.body.error), Object.keys(l.body.error)); } });
test('AC4 [safety] invalid dates are rejected like the list rejects them', async () => { for (const q of BAD_FILTERS) { const l = await json('/orders?' + q); const e = await json('/orders/export.csv?' + q); assert.equal(e.res.status, l.res.status, q); assert.equal(e.body.error.code, l.body.error.code, q); } });
test('AC5 [functional] total is a two-decimal amount equal to the cents divided by 100, for every order', async () => { const all = await listAll(); const { data } = await csv(); data.forEach((r, i) => { assert.match(r[4], /^-?\d+\.\d\d$/, r[0]); assert.equal(r[4], money(all[i].total_cents), r[0]); }); });
test('AC5 [boundary] refunds are negative amounts, including those smaller than one unit', async () => { const all = await listAll(); const { data } = await csv(); const neg = all.filter((o) => o.total_cents < 0); assert.ok(neg.some((o) => o.total_cents > -100)); for (const o of neg) assert.equal(data.find((r) => r[0] === o.id)[4], money(o.total_cents)); });
test('AC5 [boundary] the largest and the smallest amounts are exact', async () => { const all = await listAll(); const { data } = await csv(); const big = all.reduce((a, b) => (b.total_cents > a.total_cents ? b : a)); assert.ok(big.total_cents > 1e15 /* a double cannot divide it by 100 exactly */); assert.equal(data.find((r) => r[0] === big.id)[4], money(big.total_cents)); const small = all.filter((o) => o.total_cents > 0 && o.total_cents < 10); assert.ok(small.length > 0); for (const o of small) assert.equal(data.find((r) => r[0] === o.id)[4], money(o.total_cents)); });
test('AC5 [functional] id, created_at, status and currency carry the same values as the JSON API', async () => { const all = await listAll(); const { data } = await csv(); data.forEach((r, i) => assert.deepEqual([r[0], r[1], r[3], r[5]], [all[i].id, all[i].created_at, all[i].status, all[i].currency])); });
test('AC6 [safety] customer names with commas, quotes and line breaks come back exactly', async () => { const all = await listAll(); const { data } = await csv(); const odd = all.filter((o) => /[",\n\r]/.test(o.customer) && !/^[=+\-@]/.test(o.customer)); assert.ok(odd.length >= 3); for (const o of odd) assert.equal(data.find((r) => r[0] === o.id)[2], o.customer, o.id); assert.equal(data.length, all.length); });
// The ticket does not say how a formula-like name is made harmless (leading apostrophe, tab, ...), so the property is asserted: the cell
// no longer starts with = + - @ and the name is still readable in it.
test('AC6 [safety] no customer cell can start a spreadsheet formula, and the name stays readable', async () => { const all = await listAll(); const { data } = await csv(); const risky = all.filter((o) => /^[=+\-@]/.test(o.customer)); assert.ok(risky.length >= 4); for (const o of risky) { const cell = data.find((r) => r[0] === o.id)[2]; assert.ok(!/^[=+\-@]/.test(cell), o.id + ' ' + cell); assert.ok(cell.includes(o.customer), o.id + ' ' + cell); } });
test('AC6 [functional] accented and non-Latin names are intact', async () => { const names = (await csv()).data.map((x) => x[2]); assert.ok(names.includes('Zoë Müller')); assert.ok(names.includes('日本 太郎')); });
test('AC6 [functional] the file starts with a UTF-8 byte order mark, which Excel needs to read it as UTF-8', async () => { assert.deepEqual([...(await csv()).bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); });
test('AC7 [functional] the response is an attachment with a .csv file name', async () => { const cd = (await csv()).res.headers.get('content-disposition') ?? ''; assert.match(cd, /^attachment/i); assert.match(cd, /filename\*?=("?)[^";]+\.csv\1/i); });
test('AC7 [boundary] the file name carries the export date', async () => {
  const cd = (await csv()).res.headers.get('content-disposition') ?? '';
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(cd);
  assert.ok(m, cd);
  const day = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  assert.ok(Math.abs(day - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) <= 86400000, cd);
});
// The fixture's convention: sendJson in src/http.mjs sets charset=utf-8, and the README says every response carries it.
test('AC7 [functional] the content type says the text is UTF-8', async () => { assert.match((await csv()).res.headers.get('content-type') ?? '', /charset=utf-?8/i); });
test('AC8 [boundary] an empty result is a valid file with only the header row', async () => { const r = await csv('status=cancelled&from=2030-01-01'); assert.deepEqual(r.rows, [HEADER]); assert.match(r.res.headers.get('content-type') ?? '', /^text\/csv/i); });
test('AC8 [boundary] an empty result is still sent as an attachment', async () => { const r = await csv('to=2000-01-01'); assert.match(r.res.headers.get('content-disposition') ?? '', /^attachment/i); });
test('AC9 [regression] the list still has 20 per page, a cursor and the same fields', async () => { const { res, body } = await json('/orders'); assert.equal(res.status, 200); assert.equal(body.items.length, 20); assert.equal(body.next, body.items.at(-1).id); assert.deepEqual(Object.keys(body.items[0]), ['id', 'created_at', 'customer', 'status', 'total_cents', 'currency', 'note']); });
test('AC9 [regression] the list filters still behave: case-insensitive status, bounds, limits', async () => { const a = await json('/orders?status=PAID&limit=100'); assert.ok(a.body.items.length > 0 && a.body.items.every((o) => o.status === 'paid')); assert.equal((await json('/orders?limit=101')).res.status, 400); assert.equal((await json('/orders?limit=3')).body.items.length, 3); });
test('AC9 [regression] one order by id works, and unknown orders and routes are 404 with the shared error shape', async () => { assert.equal((await json('/orders/ord_001')).body.id, 'ord_001'); for (const p of ['/orders/ord_999', '/orders/export', '/nowhere']) { const r = await json(p); assert.equal(r.res.status, 404, p); assert.equal(r.body.error.code, 'not_found', p); assert.deepEqual(Object.keys(r.body.error), ['code', 'message'], p); } });
test('AC9 [regression] a wrong method on a known path keeps its 405 shape', async () => { const r = await json('/orders', { method: 'POST' }); assert.equal(r.res.status, 405); assert.equal(r.body.error.code, 'method_not_allowed'); });
test('AC10 [boundary] the README documents the new endpoint', () => { assert.ok(readFileSync(WS + '/README.md', 'utf8').includes('export.csv')); });
function testFiles(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? testFiles(dir + '/' + e.name) : e.name.endsWith('.test.mjs') ? [dir + '/' + e.name] : [])); }
test('AC11 [boundary] the new behaviour has tests in test/ (any test file there that tests export.csv)', () => { assert.ok(testFiles(WS + '/test').some((f) => { const src = readFileSync(f, 'utf8'); return src.includes('export.csv') && /\b(test|it)\(/.test(src); })); });
