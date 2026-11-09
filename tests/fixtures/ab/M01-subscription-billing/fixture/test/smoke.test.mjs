import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { subscribe } from '../src/subscriptions.mjs';

test('subscribe starts a 30-day period today', () => {
  const store = createStore({ clock: () => '2031-03-01' });
  const r = subscribe(store, { customerId: 'c1', planId: 'basic' });
  assert.equal(r.ok, true);
  assert.equal(r.value.periodEnd, '2031-03-31');
});
