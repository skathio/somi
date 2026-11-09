import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../src/server.mjs';

let server;
let base;
before(async () => { server = await start({ port: 0 }); base = `http://127.0.0.1:${server.port}`; });
after(async () => { await server.close(); });
const get = async (path) => { const res = await fetch(base + path); return { res, body: await res.json() }; };

test('the list is paged: 20 by default, with a cursor', async () => {
  const { res, body } = await get('/orders');
  assert.equal(res.status, 200);
  assert.equal(body.items.length, 20);
  assert.equal(body.next, body.items.at(-1).id);
});

test('following the cursor visits every order once', async () => {
  const seen = [];
  let after = null;
  do {
    const { body } = await get(`/orders?limit=15${after ? `&after=${after}` : ''}`);
    seen.push(...body.items.map((o) => o.id));
    after = body.next;
  } while (after);
  assert.equal(seen.length, 40);
  assert.equal(new Set(seen).size, 40);
});

test('the status filter is case-insensitive', async () => {
  const a = await get('/orders?status=PAID&limit=100');
  const b = await get('/orders?status=paid&limit=100');
  assert.ok(a.body.items.length > 0);
  assert.deepEqual(a.body, b.body);
});

test('from is inclusive and to is exclusive', async () => {
  const { body } = await get('/orders?from=2025-03-01&to=2025-04-01&limit=100');
  assert.ok(body.items.some((o) => o.created_at === '2025-03-01T00:00:00Z'));
  assert.ok(body.items.every((o) => o.created_at >= '2025-03-01T00:00:00Z' && o.created_at < '2025-04-01T00:00:00Z'));
});

test('bad queries are 400 with the shared error shape', async () => {
  for (const q of ['status=bogus', 'limit=0', 'limit=abc', 'from=yesterday', 'after=nope']) {
    const { res, body } = await get(`/orders?${q}`);
    assert.equal(res.status, 400, q);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.deepEqual(Object.keys(body.error), ['code', 'message']);
  }
});

test('one order by id, and 404s with the shared error shape', async () => {
  const ok = await get('/orders/ord_001');
  assert.equal(ok.res.status, 200);
  assert.equal(ok.body.id, 'ord_001');
  for (const path of ['/orders/ord_999', '/nowhere']) {
    const { res, body } = await get(path);
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'not_found');
  }
});
