import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleError, occurrences, occursOn } from '../src/index.mjs';

const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof RuleError);
    return e.code;
  }
  return null;
};
const base = { freq: 'daily', start: '2025-03-01' };

test('a bad rule is a RuleError with a stable code', () => {
  assert.equal(codeOf(() => occurrences(null)), 'invalid_rule');
  assert.equal(codeOf(() => occurrences({ ...base, freq: 'hourly' })), 'invalid_freq');
  assert.equal(codeOf(() => occurrences({ ...base, interval: 0 })), 'invalid_interval');
  assert.equal(codeOf(() => occurrences({ ...base, start: '2025-02-30' })), 'invalid_date');
  assert.equal(codeOf(() => occurrences({ ...base, until: '2025-02-28' })), 'invalid_end');
  assert.equal(codeOf(() => occurrences({ ...base, count: 0 })), 'invalid_end');
});

test('weekly and monthly options are checked', () => {
  assert.equal(codeOf(() => occurrences({ freq: 'weekly', start: '2025-03-03', byWeekday: ['monday'] })), 'invalid_weekday');
  assert.equal(codeOf(() => occurrences({ freq: 'weekly', start: '2025-03-03', weekStart: 'xyz' })), 'invalid_weekday');
  assert.equal(codeOf(() => occurrences({ freq: 'monthly', start: '2025-03-03', byMonthDay: [0] })), 'invalid_month_day');
  assert.equal(codeOf(() => occurrences({ ...base, byWeekday: ['mon'] })), 'invalid_option');
});

test('window arguments are checked', () => {
  assert.equal(codeOf(() => occurrences(base, { from: '2025-3-1' })), 'invalid_date');
  assert.equal(codeOf(() => occurrences(base, { limit: 1001 })), 'invalid_limit');
  assert.equal(codeOf(() => occursOn(base, 'tomorrow')), 'invalid_date');
});

test('a rule object is not changed', () => {
  const rule = { freq: 'weekly', byWeekday: ['thu', 'mon'], start: '2025-03-03' };
  const copy = structuredClone(rule);
  occurrences(rule, { limit: 5 });
  occursOn(rule, '2025-03-06');
  assert.deepEqual(rule, copy);
});
