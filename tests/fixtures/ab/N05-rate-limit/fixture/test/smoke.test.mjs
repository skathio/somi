import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';

test('items answer', () => {
  const app = createApp({ clock: () => 0 });
  assert.equal(app.handle({ method: 'GET', path: '/items', headers: {}, remote: '10.0.0.1' }).status, 200);
});
