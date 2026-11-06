// Public API: occurrences(spec, window) lists the days a rule falls on; occursOn(spec, day) asks about one day.
import { LAST_DAY, formatDay, parseDay } from './dates.mjs';
import { generate, matches } from './expand.mjs';
import { RuleError, parseRule } from './rule.mjs';

export { RuleError };

const MAX_LIMIT = 1000;

/**
 * Days of the rule inside the window, ascending, as YYYY-MM-DD strings. `from` and `to` are inclusive and default to the
 * first day of the rule and to no end; `limit` (default 100, at most 1000) caps the list.
 */
export function occurrences(spec, { from, to, limit = 100 } = {}) {
  const rule = parseRule(spec);
  const lo = from === undefined ? rule.start : parseDay(from);
  const hi = to === undefined ? LAST_DAY : parseDay(to);
  if (lo === null || hi === null) throw new RuleError('invalid_date', 'from and to must be real dates written YYYY-MM-DD');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RuleError('invalid_limit', `limit must be a whole number from 1 to ${MAX_LIMIT}`);
  const out = [];
  for (const n of generate(rule)) {
    if (n > hi || out.length >= limit) break;
    if (n >= lo) out.push(formatDay(n));
  }
  return out;
}

/** True exactly when the day is one of the rule's days. */
export function occursOn(spec, day) {
  const rule = parseRule(spec);
  const n = parseDay(day);
  if (n === null) throw new RuleError('invalid_date', 'day must be a real date written YYYY-MM-DD');
  return matches(rule, n);
}
