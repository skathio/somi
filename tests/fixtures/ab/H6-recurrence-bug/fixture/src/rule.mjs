// Validation of a rule specification. Every problem is a RuleError with a stable `code` (see the README).
import { parseDay } from './dates.mjs';

export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
const fail = (code, message) => new RuleError(code, message);

function weekdayIndex(name, option) {
  const i = typeof name === 'string' ? WEEKDAY_NAMES.indexOf(name) : -1;
  if (i < 0) throw fail('invalid_weekday', `${option} must use ${WEEKDAY_NAMES.join(', ')}`);
  return i;
}

function monthDays(list) {
  if (!Array.isArray(list) || list.length === 0) throw fail('invalid_month_day', 'byMonthDay must be a non-empty list');
  for (const d of list) {
    if (!Number.isInteger(d) || d === 0 || d < -1 || d > 31) throw fail('invalid_month_day', 'byMonthDay entries are 1 to 31, or -1 for the last day');
  }
  return [...new Set(list)];
}

// Calendars redraw the same schedules all day, so equal rules share one frozen object (and with it the engine's work on them).
const MAX_SHARED = 200;
const shared = new Map();
const signature = (r) => [r.freq, r.interval, r.start, r.until, r.count, r.byWeekday, r.byMonthDay].join('|');

/** Checks a specification and returns the normalised rule the engine works on. */
export function parseRule(spec) {
  const rule = normalise(spec);
  const key = signature(rule);
  if (!shared.has(key)) {
    if (shared.size >= MAX_SHARED) shared.clear();
    shared.set(key, Object.freeze(rule));
  }
  return shared.get(key);
}

function normalise(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw fail('invalid_rule', 'a rule is an object');
  if (!FREQUENCIES.includes(spec.freq)) throw fail('invalid_freq', `freq must be one of ${FREQUENCIES.join(', ')}`);
  const interval = spec.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) throw fail('invalid_interval', 'interval must be a whole number from 1 to 1000');
  const start = parseDay(spec.start);
  if (start === null) throw fail('invalid_date', 'start must be a real date written YYYY-MM-DD');
  const until = spec.until === undefined ? null : parseDay(spec.until);
  if (until === null && spec.until !== undefined) throw fail('invalid_date', 'until must be a real date written YYYY-MM-DD');
  if (until !== null && until < start) throw fail('invalid_end', 'until must not be before start');
  if (spec.count !== undefined && (!Number.isInteger(spec.count) || spec.count < 1)) throw fail('invalid_end', 'count must be a whole number of at least 1');
  if (spec.byWeekday !== undefined && spec.freq !== 'weekly') throw fail('invalid_option', 'byWeekday applies to weekly rules only');
  if (spec.weekStart !== undefined && spec.freq !== 'weekly') throw fail('invalid_option', 'weekStart applies to weekly rules only');
  if (spec.byMonthDay !== undefined && spec.freq !== 'monthly') throw fail('invalid_option', 'byMonthDay applies to monthly rules only');
  const byWeekday = spec.byWeekday === undefined ? null : [...new Set([].concat(spec.byWeekday).map((w) => weekdayIndex(w, 'byWeekday')))];
  return {
    freq: spec.freq,
    interval,
    start,
    until,
    count: spec.count ?? null,
    byWeekday,
    byMonthDay: spec.byMonthDay === undefined ? null : monthDays(spec.byMonthDay),
    weekStart: weekdayIndex(spec.weekStart ?? 'mon', 'weekStart'),
  };
}
