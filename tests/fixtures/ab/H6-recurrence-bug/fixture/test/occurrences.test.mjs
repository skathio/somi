import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, occursOn } from '../src/index.mjs';

test('daily rules step by the interval across month ends and a leap day', () => {
  assert.deepEqual(occurrences({ freq: 'daily', interval: 3, start: '2024-02-26' }, { limit: 4 }), ['2024-02-26', '2024-02-29', '2024-03-03', '2024-03-06']);
});

test('weekly rules use the weekday of start when byWeekday is missing', () => {
  assert.deepEqual(occurrences({ freq: 'weekly', start: '2025-03-06' }, { to: '2025-03-27' }), ['2025-03-06', '2025-03-13', '2025-03-20', '2025-03-27']);
});

test('weekly rules with several weekdays list them in calendar order', () => {
  const rule = { freq: 'weekly', byWeekday: ['thu', 'mon'], start: '2025-03-03' };
  assert.deepEqual(occurrences(rule, { to: '2025-03-14' }), ['2025-03-03', '2025-03-06', '2025-03-10', '2025-03-13']);
});

test('weekdays of the first week before start are not days of the rule', () => {
  assert.deepEqual(occurrences({ freq: 'weekly', byWeekday: ['mon', 'fri'], start: '2025-03-05' }, { limit: 3 }), ['2025-03-07', '2025-03-10', '2025-03-14']);
});

test('weekly rules with an interval use every n-th week from the week of start', () => {
  const rule = { freq: 'weekly', interval: 2, byWeekday: ['tue', 'sat'], start: '2025-03-04' };
  assert.deepEqual(occurrences(rule, { to: '2025-04-05' }), ['2025-03-04', '2025-03-08', '2025-03-18', '2025-03-22', '2025-04-01', '2025-04-05']);
});

test('monthly rules clamp to the last day of short months and recover afterwards', () => {
  assert.deepEqual(occurrences({ freq: 'monthly', start: '2025-01-31' }, { limit: 5 }), ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
  assert.deepEqual(occurrences({ freq: 'monthly', start: '2024-01-31' }, { limit: 2 }), ['2024-01-31', '2024-02-29']);
});

test('monthly rules take several month days, the last day as -1', () => {
  assert.deepEqual(occurrences({ freq: 'monthly', byMonthDay: [15, -1], start: '2025-01-10' }, { limit: 5 }), ['2025-01-15', '2025-01-31', '2025-02-15', '2025-02-28', '2025-03-15']);
});

test('yearly rules starting on 29 February use the 28th in common years', () => {
  assert.deepEqual(occurrences({ freq: 'yearly', start: '2024-02-29' }, { limit: 3 }), ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('count counts from start and until is included', () => {
  assert.deepEqual(occurrences({ freq: 'daily', count: 3, start: '2025-03-01' }), ['2025-03-01', '2025-03-02', '2025-03-03']);
  assert.deepEqual(occurrences({ freq: 'daily', until: '2025-03-03', start: '2025-03-01' }), ['2025-03-01', '2025-03-02', '2025-03-03']);
  assert.deepEqual(occurrences({ freq: 'daily', count: 3, start: '2025-03-01' }, { from: '2025-03-03' }), ['2025-03-03']);
});

test('the window is inclusive and limit caps the list', () => {
  const rule = { freq: 'daily', start: '2025-03-01' };
  assert.deepEqual(occurrences(rule, { from: '2025-03-05', to: '2025-03-07' }), ['2025-03-05', '2025-03-06', '2025-03-07']);
  assert.equal(occurrences(rule, { limit: 1000 }).length, 1000);
});

test('occursOn answers for a single day', () => {
  const rule = { freq: 'weekly', byWeekday: ['mon', 'thu'], start: '2025-03-03' };
  assert.equal(occursOn(rule, '2025-03-06'), true);
  assert.equal(occursOn(rule, '2025-03-07'), false);
  assert.equal(occursOn(rule, '2025-02-27'), false);
  assert.equal(occursOn({ freq: 'monthly', start: '2025-01-31' }, '2025-02-28'), true);
});
