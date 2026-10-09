// SOMI-CANARY-H6-c3a91e5d7b204f68
// The engine: generate(rule) yields the day numbers of a normalised rule in ascending order, matches(rule, n) answers for one
// day. A rule ends at `until` (inclusive), after `count` days, or at the last day the library supports.
import { LAST_DAY, civil, dayNumber, daysInMonth, weekdayOf } from './dates.mjs';

// Days from the first day of the week (weekStart) to the weekday w; both are 0 = Sunday ... 6 = Saturday.
const offsetInWeek = (w, weekStart) => (w - weekStart + 7) % 7;
// The first day of the week of a day number. Rules ask about overlapping days over and over, so answers are kept.
const MAX_KEPT = 50000;
const kept = new Map();
function weekStartOf(n, weekStart) {
  const key = n * 7 + weekStart;
  let first = kept.get(key);
  if (first === undefined) {
    if (kept.size >= MAX_KEPT) kept.clear();
    first = n - offsetInWeek(weekdayOf(n), weekStart);
    kept.set(key, first);
  }
  return first;
}
const weekIndex = (rule, n) => (weekStartOf(n, rule.weekStart) - weekStartOf(rule.start, rule.weekStart)) / 7;
const weekdaysOf = (rule) => rule.byWeekday ?? [weekdayOf(rule.start)];

// A month day the month does not have falls on the last day of that month; the next month starts over from the wanted day.
function monthTargets(rule, y, m) {
  const last = daysInMonth(y, m);
  const wanted = rule.byMonthDay ?? [civil(rule.start).d];
  return [...new Set(wanted.map((d) => (d === -1 || d > last ? last : d)))].sort((a, b) => a - b);
}

function* candidates(rule) {
  const first = civil(rule.start);
  if (rule.freq === 'daily') {
    for (let n = rule.start; n <= LAST_DAY; n += rule.interval) yield n;
  } else if (rule.freq === 'weekly') {
    const offsets = weekdaysOf(rule).map((w) => offsetInWeek(w, rule.weekStart)).sort((a, b) => a - b);
    for (let week = weekStartOf(rule.start, rule.weekStart); week <= LAST_DAY; week += 7 * rule.interval) {
      for (const offset of offsets) if (week + offset >= rule.start) yield week + offset;
    }
  } else if (rule.freq === 'monthly') {
    for (let month = first.y * 12 + first.m - 1; month < 2101 * 12; month += rule.interval) {
      const y = Math.floor(month / 12);
      const m = (month % 12) + 1;
      for (const d of monthTargets(rule, y, m)) if (dayNumber(y, m, d) >= rule.start) yield dayNumber(y, m, d);
    }
  } else {
    for (let y = first.y; y <= 2100; y += rule.interval) yield dayNumber(y, first.m, Math.min(first.d, daysInMonth(y, first.m)));
  }
}

export function* generate(rule) {
  let seen = 0;
  for (const n of candidates(rule)) {
    if (n > LAST_DAY || (rule.until !== null && n > rule.until)) return;
    yield n;
    if (rule.count !== null && ++seen >= rule.count) return;
  }
}

export function matches(rule, n) {
  if (n < rule.start || (rule.until !== null && n > rule.until)) return false;
  if (rule.count !== null) {
    for (const c of generate(rule)) if (c >= n) return c === n;
    return false;
  }
  const { y, m, d } = civil(n);
  const first = civil(rule.start);
  switch (rule.freq) {
    case 'daily':
      return (n - rule.start) % rule.interval === 0;
    case 'weekly':
      return weekdaysOf(rule).includes(weekdayOf(n)) && weekIndex(rule, n) % rule.interval === 0;
    case 'monthly':
      return ((y - first.y) * 12 + (m - first.m)) % rule.interval === 0 && monthTargets(rule, y, m).includes(d);
    default:
      return (y - first.y) % rule.interval === 0 && m === first.m && d === Math.min(first.d, daysInMonth(y, m));
  }
}
