// SOMI-CANARY-H6-c3a91e5d7b204f68
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const WS = process.env.TASK_WORKSPACE;
const RUNNER = fileURLToPath(new URL('./call.mjs', import.meta.url));
let hung = false; // once a call times out, later tests fail at once instead of waiting again

// One child process per test: the candidate's library is loaded there and nowhere else.
function ask(calls) {
  assert.ok(!hung, 'an earlier call timed out');
  const nonce = randomUUID();
  const r = spawnSync(process.execPath, [RUNNER, nonce], { cwd: WS, env: process.env, input: JSON.stringify(calls), encoding: 'utf8', timeout: 4000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) { hung = r.error.code === 'ETIMEDOUT'; assert.fail('the library did not answer: ' + r.error.code); }
  const m = new RegExp('H6:' + nonce + ':(.*)').exec(r.stdout ?? '');
  assert.ok(m, 'the library could not be loaded or did not answer');
  return JSON.parse(m[1]);
}
const value = (res, id) => { assert.ok(res[id].ok, `${id}: threw ${res[id].name} ${res[id].code}`); return res[id].value; };

// ---- The README's definition of a weekly rule, stated again with plain day arithmetic (no Date objects, no library code).
const DAY = 86400000;
const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const num = (s) => Date.parse(s + 'T00:00:00Z') / DAY;
const fmt = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const wd = (n) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
function model(spec, to) {
  const ws = NAMES.indexOf(spec.weekStart ?? 'mon');
  const wanted = (spec.byWeekday ?? [NAMES[wd(num(spec.start))]]).map((x) => NAMES.indexOf(x));
  const first = num(spec.start);
  const weekOf = (n) => n - ((((wd(n) - ws) % 7) + 7) % 7);
  const out = [];
  let seen = 0;
  for (let n = first; n <= num(to); n++) {
    if (spec.until && n > num(spec.until)) break;
    if (!wanted.includes(wd(n)) || ((weekOf(n) - weekOf(first)) / 7) % (spec.interval ?? 1) !== 0) continue;
    out.push(fmt(n));
    if (spec.count && ++seen >= spec.count) break;
  }
  return out;
}
const startOn = (name, near) => { let n = num(near); while (NAMES[wd(n)] !== name) n++; return fmt(n); };
const HORIZON = 100;
const horizonOf = (spec) => fmt(num(spec.start) + HORIZON);

function weeklySpecs({ weekStart, startDays, sets, intervals, extra = {} }) {
  const out = [];
  for (const name of startDays) for (const byWeekday of sets) for (const interval of intervals) {
    const spec = { freq: 'weekly', interval, start: startOn(name, '2025-03-02'), ...extra };
    if (byWeekday) spec.byWeekday = byWeekday;
    if (weekStart) spec.weekStart = weekStart;
    out.push(spec);
  }
  return out;
}
function checkLists(specs) {
  const res = ask(Object.fromEntries(specs.map((s, i) => ['l' + i, ['occurrences', s, { to: horizonOf(s), limit: 1000 }]])));
  specs.forEach((s, i) => assert.deepEqual(value(res, 'l' + i), model(s, horizonOf(s)), JSON.stringify(s)));
}
function checkDays(specs) {
  const calls = {};
  const days = (s) => Array.from({ length: HORIZON + 10 }, (_, k) => fmt(num(s.start) - 9 + k));
  specs.forEach((s, i) => days(s).forEach((d) => { calls[`${i}|${d}`] = ['occursOn', s, d]; }));
  const res = ask(calls);
  specs.forEach((s, i) => {
    const want = new Set(model(s, horizonOf(s)));
    for (const d of days(s)) assert.equal(value(res, `${i}|${d}`), want.has(d), `${JSON.stringify(s)} on ${d}`);
  });
}

const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const EXAMPLE = { freq: 'weekly', interval: 2, byWeekday: ['sun', 'wed'], start: '2025-03-02' };
const EXPECTED = ['2025-03-02', '2025-03-12', '2025-03-16', '2025-03-26', '2025-03-30'];
const SETS_ANY = [null, ['sun'], ['sun', 'wed'], ['fri', 'sun'], ['wed', 'fri'], ['mon'], ['sat', 'sun'], ALL];
const SUNDAY_START = ['sun'];

test('AC2 [regression] the reported rule lists the days the README promises', () => {
  const res = ask({ a: ['occurrences', EXAMPLE, { to: '2025-04-05' }] });
  assert.deepEqual(value(res, 'a'), EXPECTED);
});
test('AC2 [regression] the reported rule inside a window and under a limit', () => {
  const res = ask({ a: ['occurrences', EXAMPLE, { from: '2025-03-10', to: '2025-03-31' }], b: ['occurrences', EXAMPLE, { limit: 3 }], c: ['occurrences', EXAMPLE, { from: '2025-03-12', to: '2025-03-12' }], d: ['occurrences', EXAMPLE, { from: '2025-03-03', limit: 2 }] });
  assert.deepEqual(value(res, 'a'), EXPECTED.slice(1));
  assert.deepEqual(value(res, 'b'), EXPECTED.slice(0, 3));
  assert.deepEqual(value(res, 'c'), ['2025-03-12']);
  assert.deepEqual(value(res, 'd'), ['2025-03-12', '2025-03-16']);
});
test('AC2 [regression] the same rule with the week start spelled out gives the same days', () => {
  const res = ask({ a: ['occurrences', { ...EXAMPLE, weekStart: 'mon' }, { to: '2025-04-05' }] });
  assert.deepEqual(value(res, 'a'), EXPECTED);
});
test('AC3 [regression] occursOn answers for the reported rule as the list does', () => {
  const calls = {};
  const days = Array.from({ length: 46 }, (_, k) => fmt(num('2025-02-20') + k));
  for (const d of days) calls[d] = ['occursOn', EXAMPLE, d];
  const res = ask(calls);
  for (const d of days) assert.equal(value(res, d), EXPECTED.includes(d), d);
});
test('AC7 [regression] weeks starting on Monday, a rule that starts on a Sunday, every week', () => {
  checkLists(weeklySpecs({ startDays: SUNDAY_START, sets: SETS_ANY, intervals: [1] }));
});
test('AC5 [regression] weeks starting on Monday, a rule that starts on a Sunday, every second week', () => {
  checkLists(weeklySpecs({ startDays: SUNDAY_START, sets: SETS_ANY, intervals: [2] }));
});
test('AC5 [regression] weeks starting on Monday, a rule that starts on a Sunday, every third and fourth week', () => {
  checkLists(weeklySpecs({ startDays: SUNDAY_START, sets: SETS_ANY, intervals: [3, 4] }));
});
test('AC5 [regression] a Sunday start in another year and with the week start spelled out', () => {
  checkLists([{ freq: 'weekly', interval: 2, start: '2024-12-29', byWeekday: ['sun', 'thu'] }, { freq: 'weekly', interval: 3, start: '2027-01-03', weekStart: 'mon', byWeekday: ['tue', 'sun'] }, { freq: 'weekly', interval: 2, start: '2028-02-27', weekStart: 'mon', byWeekday: ['sun', 'mon'] }]);
});
test('AC5 [regression] weekdays that come before the week start, on weeks starting on Wednesday', () => {
  checkLists(weeklySpecs({ weekStart: 'wed', startDays: ALL, sets: SETS_ANY, intervals: [1, 2, 3] }));
});
test('AC5 [regression] weekdays that come before the week start, on weeks starting on Saturday', () => {
  checkLists(weeklySpecs({ weekStart: 'sat', startDays: ALL, sets: SETS_ANY, intervals: [1, 2, 3] }));
});
test('AC5 [regression] weekdays that come before the week start, on weeks starting on Tuesday, Thursday or Friday', () => {
  for (const weekStart of ['tue', 'thu', 'fri']) checkLists(weeklySpecs({ weekStart, startDays: ALL, sets: SETS_ANY, intervals: [2, 3] }));
});
test('AC5 [regression] a rule with a count, starting on a Sunday or before the week start', () => {
  checkLists([1, 2, 3, 5, 8].flatMap((count) => [
    { freq: 'weekly', interval: 2, start: '2025-03-02', byWeekday: ['sun', 'wed'], count },
    { freq: 'weekly', interval: 1, start: '2025-03-02', count },
    { freq: 'weekly', interval: 3, start: '2025-03-04', weekStart: 'wed', byWeekday: ['tue', 'mon', 'fri'], count },
  ]));
});
test('AC5 [boundary] a rule with an until day, which is included, starting on a Sunday', () => {
  checkLists(['2025-03-01', '2025-03-02', '2025-03-11', '2025-03-12', '2025-03-16', '2025-03-30', '2025-04-20'].flatMap((until) => [
    { freq: 'weekly', interval: 2, start: '2025-03-02', byWeekday: ['sun', 'wed'], until },
    { freq: 'weekly', interval: 2, start: '2025-03-02', byWeekday: ['sun', 'wed'], until, weekStart: 'sat' },
  ].filter((s) => s.until >= s.start)));
});
test('AC5 [regression] the window does not move the weeks: from and to are only a view onto the same days', () => {
  const specs = [EXAMPLE, { freq: 'weekly', interval: 3, start: '2025-03-09', byWeekday: ['fri', 'sun'] }, { freq: 'weekly', interval: 2, weekStart: 'wed', start: '2025-03-03', byWeekday: ['mon', 'fri'] }];
  const calls = {};
  const windows = [['2025-03-03', '2025-03-20'], ['2025-03-11', '2025-04-30'], ['2025-03-17', '2025-03-17'], ['2025-04-01', '2025-05-31']];
  specs.forEach((s, i) => windows.forEach(([from, to], j) => { calls[`${i}|${j}`] = ['occurrences', s, { from, to, limit: 1000 }]; }));
  const res = ask(calls);
  specs.forEach((s, i) => windows.forEach(([from, to], j) => assert.deepEqual(value(res, `${i}|${j}`), model(s, to).filter((d) => d >= from), `${JSON.stringify(s)} ${from}..${to}`)));
});
test('AC5 [regression] occursOn for rules that start on a Sunday, every week or every second week', () => {
  checkDays(weeklySpecs({ startDays: SUNDAY_START, sets: SETS_ANY, intervals: [1, 2] }));
});
test('AC5 [regression] occursOn for rules that start on a Sunday, every third or fourth week', () => {
  checkDays(weeklySpecs({ startDays: SUNDAY_START, sets: SETS_ANY.slice(0, 5), intervals: [3, 4] }));
});
test('AC5 [regression] occursOn for weekdays that come before the week start (Wednesday and Saturday weeks)', () => {
  checkDays(weeklySpecs({ weekStart: 'wed', startDays: ['mon', 'sun', 'wed'], sets: SETS_ANY.slice(0, 5), intervals: [1, 2, 3] }));
  checkDays(weeklySpecs({ weekStart: 'sat', startDays: ['fri', 'sun', 'sat'], sets: SETS_ANY.slice(0, 5), intervals: [2, 3] }));
});
test('AC5 [regression] occursOn for a rule with a count or an until day, starting on a Sunday', () => {
  checkDays([{ freq: 'weekly', interval: 2, start: '2025-03-02', byWeekday: ['sun', 'wed'], count: 4 }, { freq: 'weekly', interval: 2, start: '2025-03-02', byWeekday: ['sun', 'wed'], until: '2025-03-26' }]);
});
test('AC6 [functional] the list and occursOn never disagree, for any weekly rule of the kinds above', () => {
  const specs = [...weeklySpecs({ startDays: ['sun', 'fri'], sets: [null, ['sun', 'wed'], ['fri', 'sun']], intervals: [2, 3] }), ...weeklySpecs({ weekStart: 'wed', startDays: ['tue', 'wed'], sets: [['mon', 'fri'], ['tue', 'thu']], intervals: [2] })];
  const calls = {};
  const span = (s) => Array.from({ length: 70 }, (_, k) => fmt(num(s.start) - 5 + k));
  specs.forEach((s, i) => { calls[`list${i}`] = ['occurrences', s, { from: fmt(num(s.start) - 5), to: fmt(num(s.start) + 64), limit: 1000 }]; span(s).forEach((d) => { calls[`${i}|${d}`] = ['occursOn', s, d]; }); });
  const res = ask(calls);
  specs.forEach((s, i) => { const listed = new Set(value(res, `list${i}`)); for (const d of span(s)) assert.equal(value(res, `${i}|${d}`), listed.has(d), `${JSON.stringify(s)} on ${d}`); });
});

// ---- A rule gives the days the README defines, whatever was asked before it and however often.
const EX_SUN = { ...EXAMPLE, weekStart: 'sun' };
const SUN_DAYS = ['2025-03-02', '2025-03-05', '2025-03-16', '2025-03-19', '2025-03-30', '2025-04-02'];
const UNTIL = { to: '2025-04-05' };
test('AC2 [functional] the reported rule gives the expected days after the same rule was listed with weeks starting on Sunday', () => {
  const res = ask({ p: ['occurrences', EX_SUN, UNTIL], a: ['occurrences', EXAMPLE, UNTIL] });
  assert.deepEqual(value(res, 'p'), SUN_DAYS);
  assert.deepEqual(value(res, 'a'), EXPECTED);
});
test('AC2 [functional] the reported rule gives the expected days after the Sunday-week variant was asked about day by day', () => {
  const res = ask({ p1: ['occursOn', EX_SUN, '2025-03-05'], p2: ['occursOn', EX_SUN, '2025-03-12'], a: ['occurrences', EXAMPLE, UNTIL], b: ['occursOn', EXAMPLE, '2025-03-12'], c: ['occursOn', EXAMPLE, '2025-03-05'] });
  assert.equal(value(res, 'p1'), true);
  assert.equal(value(res, 'p2'), false);
  assert.deepEqual(value(res, 'a'), EXPECTED);
  assert.equal(value(res, 'b'), true);
  assert.equal(value(res, 'c'), false);
});
test('AC2 [functional] the Sunday-week variant gives its own days after the reported rule was listed', () => {
  const res = ask({ a: ['occurrences', EXAMPLE, UNTIL], p: ['occurrences', EX_SUN, UNTIL], q: ['occursOn', EX_SUN, '2025-03-05'] });
  assert.deepEqual(value(res, 'a'), EXPECTED);
  assert.deepEqual(value(res, 'p'), SUN_DAYS);
  assert.equal(value(res, 'q'), true);
});
test('AC6 [functional] the reported rule is not disturbed by the same rule with any other first day of the week asked before', () => {
  for (const weekStart of ['sat', 'fri', 'thu', 'wed', 'tue', 'sun']) {
    const res = ask({ p: ['occurrences', { ...EXAMPLE, weekStart }, UNTIL], a: ['occurrences', EXAMPLE, UNTIL] });
    assert.deepEqual(value(res, 'a'), EXPECTED, weekStart);
  }
});
test('AC6 [functional] two different rules with different first days of the week do not disturb each other, either way round', () => {
  const r1 = { freq: 'weekly', interval: 2, byWeekday: ['mon', 'fri'], weekStart: 'wed', start: '2025-03-03' };
  const r2 = { freq: 'weekly', interval: 2, byWeekday: ['tue', 'sat'], start: '2025-03-03' };
  for (const order of [[r1, r2], [r2, r1]]) {
    const res = ask(Object.fromEntries(order.map((r, i) => ['x' + i, ['occurrences', r, { to: horizonOf(r), limit: 1000 }]])));
    order.forEach((r, i) => assert.deepEqual(value(res, 'x' + i), model(r, horizonOf(r)), JSON.stringify(r)));
  }
});
const ORDER_RULES = [
  { freq: 'weekly', interval: 2, byWeekday: ['sun', 'wed'], start: '2025-03-02' },
  { freq: 'weekly', interval: 2, byWeekday: ['sun', 'wed'], start: '2025-03-02', weekStart: 'sun' },
  { freq: 'weekly', interval: 2, byWeekday: ['sun', 'wed'], start: '2025-03-02', weekStart: 'sat' },
  { freq: 'weekly', interval: 3, byWeekday: ['mon', 'fri'], start: '2025-03-03', weekStart: 'wed' },
  { freq: 'weekly', interval: 3, byWeekday: ['mon', 'fri'], start: '2025-03-03' },
  { freq: 'weekly', byWeekday: ['thu', 'sun'], start: '2025-03-06', weekStart: 'thu' },
  { freq: 'weekly', byWeekday: ['thu', 'sun'], start: '2025-03-06', weekStart: 'sun' },
  { freq: 'weekly', interval: 2, start: '2025-03-04', weekStart: 'tue' },
];
function inThisOrder(order) {
  const calls = {};
  const dayList = (r) => Array.from({ length: 34 }, (_, k) => fmt(num(r.start) - 3 + k));
  for (const i of order) {
    calls['l' + i] = ['occurrences', ORDER_RULES[i], { to: horizonOf(ORDER_RULES[i]), limit: 1000 }];
    for (const d of dayList(ORDER_RULES[i])) calls[`d${i}|${d}`] = ['occursOn', ORDER_RULES[i], d];
  }
  const res = ask(calls);
  for (const i of order) {
    const r = ORDER_RULES[i];
    assert.deepEqual(value(res, 'l' + i), model(r, horizonOf(r)), 'list of ' + JSON.stringify(r));
    const want = new Set(model(r, horizonOf(r)));
    for (const d of dayList(r)) assert.equal(value(res, `d${i}|${d}`), want.has(d), `${JSON.stringify(r)} on ${d}`);
  }
}
test('AC6 [functional] eight weekly rules, asked in listing order, each give their own days', () => inThisOrder([0, 1, 2, 3, 4, 5, 6, 7]));
test('AC6 [functional] the same eight rules, asked in reverse order, each give their own days', () => inThisOrder([7, 6, 5, 4, 3, 2, 1, 0]));
test('AC6 [functional] the same eight rules, asked in a mixed order, each give their own days', () => inThisOrder([3, 0, 6, 2, 5, 1, 7, 4]));
test('AC6 [functional] a rule asked again between other rules gives the same days every time', () => {
  const [x, y] = [ORDER_RULES[1], ORDER_RULES[0]];
  const calls = {};
  ['s0', 's1', 's2', 's3', 's4'].forEach((id, i) => { calls[id] = ['occurrences', i % 2 === 0 ? x : y, { to: horizonOf(x), limit: 1000 }]; });
  const res = ask(calls);
  [0, 2, 4].forEach((i) => assert.deepEqual(value(res, 's' + i), model(x, horizonOf(x)), 's' + i));
  [1, 3].forEach((i) => assert.deepEqual(value(res, 's' + i), model(y, horizonOf(y)), 's' + i));
});

// ---- Everything that works today keeps working. The cases below describe behaviour documented in the README.
test('AC7 [regression] weekly rules on Monday weeks with weekdays from Monday to Saturday', () => {
  const mf = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const specs = weeklySpecs({ startDays: mf, sets: [null, ['mon'], ['tue', 'thu'], ['wed', 'sat'], ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], ['sat', 'mon']], intervals: [1, 2, 3, 4] });
  checkLists(specs);
  checkDays(specs.filter((_, i) => i % 5 === 0));
});
test('AC7 [regression] weekly rules on Sunday weeks, from any start and with any weekdays', () => {
  const specs = weeklySpecs({ weekStart: 'sun', startDays: ALL, sets: SETS_ANY, intervals: [1, 2, 3] });
  checkLists(specs);
  checkDays(specs.filter((_, i) => i % 7 === 0));
});
test('AC7 [regression] weekly rules on Thursday weeks that use Thursday to Saturday', () => {
  const specs = weeklySpecs({ weekStart: 'thu', startDays: ['thu', 'fri', 'sat'], sets: [null, ['thu'], ['fri', 'sat'], ['thu', 'sat']], intervals: [1, 2, 3] });
  checkLists(specs);
  checkDays(specs.filter((_, i) => i % 4 === 0));
});
test('AC7 [regression] the days around a clock change are ordinary days', () => {
  const rules = [{ freq: 'daily', start: '2025-03-07' }, { freq: 'daily', interval: 2, start: '2025-10-30' }, { freq: 'weekly', weekStart: 'sun', byWeekday: ['sat', 'sun', 'mon'], start: '2025-03-05' }, { freq: 'weekly', byWeekday: ['tue', 'sat'], start: '2025-03-04' }, { freq: 'weekly', interval: 2, weekStart: 'sun', start: '2025-10-26', byWeekday: ['sun', 'wed'] }];
  const calls = Object.fromEntries(rules.map((r, i) => [i, ['occurrences', r, { to: fmt(num(r.start) + 14), limit: 100 }]]));
  const res = ask(calls);
  const dailyOf = (r) => Array.from({ length: 15 }, (_, k) => fmt(num(r.start) + k * (r.interval ?? 1))).filter((d) => d <= fmt(num(r.start) + 14));
  assert.deepEqual(value(res, 0), dailyOf(rules[0]));
  assert.deepEqual(value(res, 1), dailyOf(rules[1]));
  rules.slice(2).forEach((r, i) => assert.deepEqual(value(res, i + 2), model(r, fmt(num(r.start) + 14)), JSON.stringify(r)));
});
test('AC7 [regression] daily rules step by the interval over month ends, leap days and the end of the supported years', () => {
  const res = ask({
    a: ['occurrences', { freq: 'daily', interval: 3, start: '2024-02-26' }, { limit: 4 }],
    b: ['occurrences', { freq: 'daily', start: '2100-02-27' }, { limit: 3 }],
    c: ['occurrences', { freq: 'daily', start: '2100-12-29' }],
    d: ['occurrences', { freq: 'daily', interval: 10, start: '2025-12-25' }, { limit: 3 }],
    e: ['occurrences', { freq: 'daily', start: '2028-02-28' }, { limit: 3 }],
  });
  assert.deepEqual(value(res, 'a'), ['2024-02-26', '2024-02-29', '2024-03-03', '2024-03-06']);
  assert.deepEqual(value(res, 'b'), ['2100-02-27', '2100-02-28', '2100-03-01']);
  assert.deepEqual(value(res, 'c'), ['2100-12-29', '2100-12-30', '2100-12-31']);
  assert.deepEqual(value(res, 'd'), ['2025-12-25', '2026-01-04', '2026-01-14']);
  assert.deepEqual(value(res, 'e'), ['2028-02-28', '2028-02-29', '2028-03-01']);
});
test('AC7 [regression] monthly rules fall on the last day of a short month and start over afterwards', () => {
  const res = ask({
    a: ['occurrences', { freq: 'monthly', start: '2025-01-31' }, { limit: 5 }],
    b: ['occurrences', { freq: 'monthly', interval: 2, start: '2025-01-31' }, { limit: 6 }],
    c: ['occurrences', { freq: 'monthly', start: '2025-01-30' }, { limit: 3 }],
    d: ['occurrences', { freq: 'monthly', start: '2024-01-31' }, { limit: 3 }],
    e: ['occurrences', { freq: 'monthly', start: '2025-11-15' }, { limit: 4 }],
  });
  assert.deepEqual(value(res, 'a'), ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
  assert.deepEqual(value(res, 'b'), ['2025-01-31', '2025-03-31', '2025-05-31', '2025-07-31', '2025-09-30', '2025-11-30']);
  assert.deepEqual(value(res, 'c'), ['2025-01-30', '2025-02-28', '2025-03-30']);
  assert.deepEqual(value(res, 'd'), ['2024-01-31', '2024-02-29', '2024-03-31']);
  assert.deepEqual(value(res, 'e'), ['2025-11-15', '2025-12-15', '2026-01-15', '2026-02-15']);
});
test('AC7 [regression] monthly rules with month days: several days, the last day, days before the start', () => {
  const res = ask({
    a: ['occurrences', { freq: 'monthly', byMonthDay: [29, 30, 31], start: '2025-01-01' }, { to: '2025-03-31' }],
    b: ['occurrences', { freq: 'monthly', byMonthDay: [-1], start: '2025-01-01' }, { limit: 3 }],
    c: ['occurrences', { freq: 'monthly', byMonthDay: [10, 25], start: '2025-01-20' }, { limit: 3 }],
    d: ['occurrences', { freq: 'monthly', byMonthDay: [31], start: '2024-02-10' }, { limit: 3 }],
    e: ['occurrences', { freq: 'monthly', interval: 3, byMonthDay: [1, -1], start: '2025-01-15' }, { limit: 5 }],
  });
  assert.deepEqual(value(res, 'a'), ['2025-01-29', '2025-01-30', '2025-01-31', '2025-02-28', '2025-03-29', '2025-03-30', '2025-03-31']);
  assert.deepEqual(value(res, 'b'), ['2025-01-31', '2025-02-28', '2025-03-31']);
  assert.deepEqual(value(res, 'c'), ['2025-01-25', '2025-02-10', '2025-02-25']);
  assert.deepEqual(value(res, 'd'), ['2024-02-29', '2024-03-31', '2024-04-30']);
  assert.deepEqual(value(res, 'e'), ['2025-01-31', '2025-04-01', '2025-04-30', '2025-07-01', '2025-07-31']);
});
test('AC7 [regression] yearly rules, including the 29th of February', () => {
  const res = ask({
    a: ['occurrences', { freq: 'yearly', start: '2024-02-29' }, { limit: 6 }],
    b: ['occurrences', { freq: 'yearly', interval: 4, start: '2024-02-29' }, { limit: 3 }],
    c: ['occurrences', { freq: 'yearly', interval: 2, start: '2025-12-31' }, { limit: 3 }],
    d: ['occurrences', { freq: 'yearly', start: '2099-06-15' }],
  });
  assert.deepEqual(value(res, 'a'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28']);
  assert.deepEqual(value(res, 'b'), ['2024-02-29', '2028-02-29', '2032-02-29']);
  assert.deepEqual(value(res, 'c'), ['2025-12-31', '2027-12-31', '2029-12-31']);
  assert.deepEqual(value(res, 'd'), ['2099-06-15', '2100-06-15']);
});
test('AC7 [regression] count counts from the start and until is included, for every kind of rule', () => {
  const res = ask({
    a: ['occurrences', { freq: 'monthly', start: '2025-01-31', count: 3 }],
    b: ['occurrences', { freq: 'monthly', start: '2025-01-31', count: 3 }, { from: '2025-03-01' }],
    c: ['occurrences', { freq: 'yearly', start: '2024-02-29', until: '2026-02-28' }],
    d: ['occurrences', { freq: 'daily', start: '2025-03-01', until: '2025-03-01' }],
    e: ['occurrences', { freq: 'daily', start: '2025-03-01', count: 1 }],
    f: ['occurrences', { freq: 'daily', interval: 2, start: '2025-03-01', count: 10, until: '2025-03-06' }],
    g: ['occurrences', { freq: 'weekly', byWeekday: ['tue', 'fri'], start: '2025-03-04', count: 3 }],
  });
  assert.deepEqual(value(res, 'a'), ['2025-01-31', '2025-02-28', '2025-03-31']);
  assert.deepEqual(value(res, 'b'), ['2025-03-31']);
  assert.deepEqual(value(res, 'c'), ['2024-02-29', '2025-02-28', '2026-02-28']);
  assert.deepEqual(value(res, 'd'), ['2025-03-01']);
  assert.deepEqual(value(res, 'e'), ['2025-03-01']);
  assert.deepEqual(value(res, 'f'), ['2025-03-01', '2025-03-03', '2025-03-05']);
  assert.deepEqual(value(res, 'g'), ['2025-03-04', '2025-03-07', '2025-03-11']);
});
test('AC7 [regression] the window is inclusive, limit caps the list and defaults to 100', () => {
  const daily = { freq: 'daily', start: '2025-03-01' };
  const res = ask({
    a: ['occurrences', daily, { from: '2025-03-05', to: '2025-03-07' }],
    b: ['occurrences', daily, { from: '2025-03-05', to: '2025-03-04' }],
    c: ['occurrences', daily, { from: '2025-02-01', to: '2025-03-02' }],
    d: ['occurrences', daily, { from: '2025-03-10', limit: 2 }],
    e: ['occurrences', daily],
    f: ['occurrences', daily, { limit: 1000 }],
    g: ['occurrences', { ...daily, count: 3 }, { from: '2025-03-04' }],
    h: ['occurrences', daily, {}],
  });
  assert.deepEqual(value(res, 'a'), ['2025-03-05', '2025-03-06', '2025-03-07']);
  assert.deepEqual(value(res, 'b'), []);
  assert.deepEqual(value(res, 'c'), ['2025-03-01', '2025-03-02']);
  assert.deepEqual(value(res, 'd'), ['2025-03-10', '2025-03-11']);
  assert.equal(value(res, 'e').length, 100);
  assert.equal(value(res, 'f').length, 1000);
  assert.deepEqual(value(res, 'g'), []);
  assert.equal(value(res, 'h').length, 100);
});
test('AC7 [regression] occursOn agrees with the list for daily, monthly, yearly and Monday-week rules', () => {
  const rules = [{ freq: 'daily', interval: 4, start: '2025-02-25' }, { freq: 'monthly', start: '2025-01-31' }, { freq: 'monthly', interval: 2, byMonthDay: [-1, 15], start: '2025-01-05' }, { freq: 'yearly', start: '2024-02-29', interval: 1 }, { freq: 'weekly', start: '2025-03-04', byWeekday: ['tue', 'thu'], interval: 2 }, { freq: 'daily', start: '2025-03-01', count: 5 }, { freq: 'monthly', start: '2025-01-31', until: '2025-04-30' }];
  const span = Array.from({ length: 460 }, (_, k) => fmt(num('2024-12-01') + k));
  const calls = {};
  rules.forEach((r, i) => { calls[`list${i}`] = ['occurrences', r, { from: '2024-12-01', to: span.at(-1), limit: 1000 }]; span.forEach((d) => { calls[`${i}|${d}`] = ['occursOn', r, d]; }); });
  const res = ask(calls);
  rules.forEach((r, i) => { const listed = new Set(value(res, `list${i}`)); assert.ok(listed.size > 0, JSON.stringify(r)); for (const d of span) assert.equal(value(res, `${i}|${d}`), listed.has(d), `${JSON.stringify(r)} on ${d}`); });
});
test('AC7 [regression] invalid rules and arguments are refused with the documented codes', () => {
  const ok = { freq: 'daily', start: '2025-03-01' };
  const bad = {
    invalid_rule: [null, [], 'daily', 5],
    invalid_freq: [{ ...ok, freq: 'hourly' }, { ...ok, freq: undefined }, { ...ok, freq: 'Daily' }],
    invalid_interval: [{ ...ok, interval: 0 }, { ...ok, interval: 1001 }, { ...ok, interval: 1.5 }, { ...ok, interval: '2' }],
    invalid_date: [{ ...ok, start: '2025-02-29' }, { ...ok, start: '2025-3-1' }, { ...ok, start: '1899-12-31' }, { ...ok, start: '2101-01-01' }, { ...ok, start: undefined }, { ...ok, until: '2025-13-01' }],
    invalid_weekday: [{ freq: 'weekly', start: '2025-03-03', byWeekday: ['monday'] }, { freq: 'weekly', start: '2025-03-03', weekStart: 'xyz' }, { freq: 'weekly', start: '2025-03-03', byWeekday: [3] }],
    invalid_month_day: [{ freq: 'monthly', start: '2025-03-03', byMonthDay: [0] }, { freq: 'monthly', start: '2025-03-03', byMonthDay: [32] }, { freq: 'monthly', start: '2025-03-03', byMonthDay: [] }, { freq: 'monthly', start: '2025-03-03', byMonthDay: [-2] }],
    invalid_end: [{ ...ok, until: '2025-02-28' }, { ...ok, count: 0 }, { ...ok, count: 1.5 }],
    invalid_option: [{ ...ok, byWeekday: ['mon'] }, { ...ok, weekStart: 'sun' }, { ...ok, byMonthDay: [1] }, { freq: 'weekly', start: '2025-03-03', byMonthDay: [1] }],
  };
  const calls = {};
  for (const [code, rules] of Object.entries(bad)) rules.forEach((r, i) => { calls[`${code}|${i}`] = ['occurrences', r]; });
  calls['invalid_date|window'] = ['occurrences', ok, { from: '2025-3-1' }];
  calls['invalid_date|windowTo'] = ['occurrences', ok, { to: '2025-02-30' }];
  calls['invalid_limit|0'] = ['occurrences', ok, { limit: 0 }];
  calls['invalid_limit|1001'] = ['occurrences', ok, { limit: 1001 }];
  calls['invalid_limit|frac'] = ['occurrences', ok, { limit: 2.5 }];
  calls['invalid_date|day'] = ['occursOn', ok, 'tomorrow'];
  calls['invalid_date|day2'] = ['occursOn', ok, '2025-02-29'];
  calls['invalid_freq|on'] = ['occursOn', { ...ok, freq: 'x' }, '2025-03-01'];
  const res = ask(calls);
  for (const id of Object.keys(calls)) {
    assert.equal(res[id].ok, false, `${id} must be refused`);
    assert.equal(res[id].isRuleError, true, `${id} must be a RuleError`);
    assert.equal(res[id].name, 'RuleError', id);
    assert.equal(res[id].code, id.split('|')[0], id);
  }
});
test('AC7 [regression] the library is pure and answers the same way twice, and its public surface is unchanged', () => {
  const rules = [{ freq: 'weekly', byWeekday: ['thu', 'mon'], start: '2025-03-03', interval: 2 }, { freq: 'monthly', byMonthDay: [31, 1], start: '2025-01-31', count: 4 }, { freq: 'yearly', start: '2024-02-29' }, { freq: 'weekly', weekStart: 'sun', byWeekday: ['sat', 'sun'], start: '2025-03-05' }];
  const calls = { api: ['$exports'] };
  rules.forEach((r, i) => { calls[`l${i}`] = ['occurrences', r, { limit: 7 }]; calls[`o${i}`] = ['occursOn', r, '2025-03-06']; });
  const res = ask(calls);
  assert.deepEqual(value(res, 'api'), ['RuleError', 'occurrences', 'occursOn']);
  for (const id of Object.keys(calls)) { assert.equal(res[id].mutated, false, `${id} changed its argument`); assert.equal(res[id].same, true, `${id} answered differently the second time`); }
});

// ---- A test for this bug is added to the project's own tests. The fixture has 16 tests.
const FIXTURE_TESTS = 16;
function testFiles(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? testFiles(dir + '/' + e.name) : e.name.endsWith('.test.mjs') ? [dir + '/' + e.name] : [])); }
test('AC8 [boundary] the project has more tests in test/ than before', () => {
  const count = testFiles(WS + '/test').reduce((sum, f) => sum + (readFileSync(f, 'utf8').match(/\b(?:test|it)\(/g) ?? []).length, 0);
  assert.ok(count > FIXTURE_TESTS, `${count} tests in test/`);
});
