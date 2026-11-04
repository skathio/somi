import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drain } from '../src/deliver.mjs';
import { enqueue } from '../src/enqueue.mjs';

test('delivers one event', async () => {
  const queue = { events: [], dead: [] };
  const sent = [];
  enqueue(queue, { id: 'e1', url: 'u', payload: { a: 1 } }, { clock: () => 0, secret: 's' });
  await drain(queue, { http: { post: async (url, req) => { sent.push(req); return { status: 200 }; } }, clock: () => 0, secret: 's' });
  assert.equal(sent.length, 1);
});
