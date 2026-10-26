// SOMI-CANARY-H4-9b3f2a61d07e4c58
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../src/server.mjs';

let server;
let base;
before(async () => { server = await start({ port: 0 }); base = `http://127.0.0.1:${server.port}`; });
after(async () => { await server.close(); });

test('a file in a folder is sent as stored, with a type that fits it', async () => {
  const res = await fetch(`${base}/files/reports/alpha.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain; charset=utf-8$/);
  assert.equal(await res.text(), 'reports/alpha.txt\nshared file\n');
});

test('a byte range answers 206 with Content-Range, and one past the end is refused', async () => {
  const part = await fetch(`${base}/files/blob.bin`, { headers: { range: 'bytes=-10' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 4086-4095/4096');
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  const none = await fetch(`${base}/files/blob.bin`, { headers: { range: 'bytes=4096-' } });
  assert.equal(none.status, 416);
  assert.equal(none.headers.get('content-range'), 'bytes */4096');
});

test('the listing links every entry with an encoded address', async () => {
  const html = await (await fetch(`${base}/files/`)).text();
  assert.ok(html.includes('href="/files/50%25%20off%20%231.txt"'));
  assert.ok(html.includes('&lt;b&gt;bold.txt'));
});

test('paths that leave the shared folder, or are malformed, are refused', async () => {
  for (const p of ['..%2fconfig%2fserver.json', '..%2fshared-internal%2fsecret.txt', '%2fetc%2fpasswd', '%zz']) {
    const res = await fetch(`${base}/files/${p}`);
    assert.ok([400, 404].includes(res.status), p);
  }
  assert.equal((await fetch(`${base}/files/nope.txt`)).status, 404);
  assert.equal((await fetch(`${base}/files/hello.txt`, { method: 'POST' })).status, 405);
});
