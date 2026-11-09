import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canInstall } from '../src/plugins.mjs';

test('a plugin with no range installs', () => {
  assert.equal(canInstall({ name: 'a' }, '1.0.0'), true);
});
