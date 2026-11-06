import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderText } from '../src/template.mjs';

test('fills in', () => {
  assert.equal(renderText('Hi {{name}}', { name: 'A&B' }), 'Hi A&B');
});
