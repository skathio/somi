import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../src/server.mjs';

let server;
let base;
before(async () => { server = await start({ port: 0 }); base = `http://127.0.0.1:${server.port}`; });
after(async () => { await server.close(); });
const get = async (path, init) => { const res = await fetch(base + path, init); return { res, body: await res.json() }; };

test('health answers ok', async () => {
  const { res, body } = await get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(body, { status: 'ok' });
});

test('the file list has folders first, then files, each by lower-case name', async () => {
  const { res, body } = await get('/api/files');
  assert.equal(res.status, 200);
  const types = body.items.map((e) => e.type);
  assert.equal(types.indexOf('file'), types.lastIndexOf('dir') + 1);
  for (const group of ['dir', 'file']) {
    const names = body.items.filter((e) => e.type === group).map((e) => e.name.toLowerCase());
    assert.deepEqual(names, [...names].sort());
  }
});

test('an entry has a name, a type and a size, and a folder has no size', async () => {
  const { body } = await get('/api/files');
  for (const e of body.items) assert.deepEqual(Object.keys(e), ['name', 'type', 'size']);
  assert.ok(body.items.filter((e) => e.type === 'dir').every((e) => e.size === null));
  assert.equal(body.items.find((e) => e.name === 'blob.bin').size, 4096);
});

test('unknown routes are 404 and wrong methods are 405, with the shared error shape', async () => {
  const missing = await get('/nowhere');
  assert.equal(missing.res.status, 404);
  assert.deepEqual(missing.body, { error: { code: 'not_found', message: 'no such route' } });
  const wrong = await get('/api/files', { method: 'POST' });
  assert.equal(wrong.res.status, 405);
  assert.equal(wrong.body.error.code, 'method_not_allowed');
});
