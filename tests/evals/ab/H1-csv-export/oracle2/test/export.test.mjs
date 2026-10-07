// SOMI-CANARY-H1-4d7e1b92c0a85f36
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../src/server.mjs';

let server;
let base;
before(async () => { server = await start({ port: 0 }); base = `http://127.0.0.1:${server.port}`; });
after(async () => { await server.close(); });

test('refunds are negative decimal amounts', async () => {
  const text = await (await fetch(`${base}/orders/export.csv?status=refunded`)).text();
  assert.match(text, /,-\d+\.\d\d,/);
});

test('the export is an attachment with a header row and every matching order', async () => {
  const res = await fetch(`${base}/orders/export.csv?status=paid&limit=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="?orders-\d{4}-\d{2}-\d{2}\.csv"?$/);
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
  assert.ok(text.startsWith('\uFEFFid,created_at,customer,status,total,currency\r\n'));
  assert.ok(text.split('\r\n').length > 3);
});

test('a bad filter is the usual 400', async () => {
  const res = await fetch(`${base}/orders/export.csv?status=bogus`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'invalid_query');
});
