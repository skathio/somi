import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { defineFlag, isEnabled, setEnabled } from '../src/flags.mjs';

test('a flag turned on is on', () => {
  const store = createStore({ clock: () => '2031-05-01T00:00:00Z' });
  defineFlag(store, 'beta');
  setEnabled(store, 'beta', true);
  assert.equal(isEnabled(store, 'beta'), true);
});
