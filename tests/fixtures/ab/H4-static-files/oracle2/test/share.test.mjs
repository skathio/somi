// SOMI-CANARY-H4-9b3f2a61d07e4c58
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../src/server.mjs';

let server;
let base;
before(async () => { server = await start({ port: 0 }); base = `http://127.0.0.1:${server.port}`; });
after(async () => { await server.close(); });

test('GET /files/ lists the shared folder and /files/<name> sends a file', async () => {
  const page = await fetch(`${base}/files/`);
  assert.match(page.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.ok((await page.text()).includes('href="/files/hello.txt"'));
  const file = await fetch(`${base}/files/hello.txt`);
  assert.equal(await file.text(), 'hello.txt\nshared file\n');
});

test('GET /files/<name> with a range sends only those bytes', async () => {
  const res = await fetch(`${base}/files/blob.bin`, { headers: { range: 'bytes=0-3' } });
  assert.equal(res.status, 206);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [3, 10, 17, 24]);
});

test('a path outside the shared folder is refused and a missing one is not found', async () => {
  assert.equal((await fetch(`${base}/files/..%2fconfig%2fserver.json`)).status, 400);
  assert.equal((await fetch(`${base}/files/missing.txt`)).status, 404);
});
