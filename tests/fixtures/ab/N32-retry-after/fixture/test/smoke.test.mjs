import { test } from 'node:test';
import assert from 'node:assert/strict';
import { send } from '../src/client.mjs';

test('a call', async () => {
  const r = await send({ method: 'GET', url: 'u' }, { http: async () => ({ status: 200, headers: {}, body: 'ok' }), clock: () => 0, sleep: async () => {} });
  assert.equal(r.body, 'ok');
});
