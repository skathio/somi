// SOMI-CANARY-H6-c3a91e5d7b204f68
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences } from '../src/index.mjs';

const base = { freq: 'weekly', byWeekday: ['tue', 'sat'], interval: 2, start: '2025-03-04' };
const asked = (rule) => occurrences(rule, { to: '2025-04-15' });

test('the same rule gives the same days after a rule with another week start', () => {
  const fresh = asked(base);
  asked({ ...base, weekStart: 'sat' });
  assert.deepEqual(asked(base), fresh);
});

test('two different rules with different week starts do not disturb each other', () => {
  const a = asked({ ...base, byWeekday: ['mon', 'sun'], weekStart: 'tue' });
  const b = asked({ ...base, byWeekday: ['sun'] });
  assert.deepEqual(asked({ ...base, byWeekday: ['mon', 'sun'], weekStart: 'tue' }), a);
  assert.deepEqual(asked({ ...base, byWeekday: ['sun'] }), b);
});
