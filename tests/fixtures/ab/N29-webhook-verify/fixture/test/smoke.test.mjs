import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventType } from '../src/inbound.mjs';

test('a type', () => {
  assert.equal(eventType({ type: 'x' }), 'x');
});
