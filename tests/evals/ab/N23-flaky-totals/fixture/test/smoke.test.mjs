import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topRegions } from '../src/totals.mjs';

test('biggest first', () => {
  assert.equal(topRegions([{ region: 'a', total: 1 }, { region: 'b', total: 2 }], 1)[0].region, 'b');
});
