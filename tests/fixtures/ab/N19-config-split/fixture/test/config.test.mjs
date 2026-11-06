import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.mjs';

test('a simple file', () => {
  assert.deepEqual(parseConfig('A=1\nB=${A}2\n'), { A: '1', B: '12' });
});
