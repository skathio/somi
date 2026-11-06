import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listBundle } from '../src/bundles.mjs';

test('lists paths', () => {
  assert.deepEqual(listBundle([{ path: 'a.txt', content: '' }]), ['a.txt']);
});
