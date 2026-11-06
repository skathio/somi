import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../src/format.mjs';

test('dollars', () => {
  assert.equal(formatMoney(1234, 'USD'), '$12.34');
});
