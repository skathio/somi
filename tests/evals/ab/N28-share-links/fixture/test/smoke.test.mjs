import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileName } from '../src/files.mjs';

test('a name', () => {
  assert.equal(fileName('a'), 'file-a');
});
