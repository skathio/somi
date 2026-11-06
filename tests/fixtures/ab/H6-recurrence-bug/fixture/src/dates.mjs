// Calendar-day arithmetic. A day is a string YYYY-MM-DD; inside the library it is a day number (days since 1970-01-01).
// Nothing here depends on the clock or the time zone of the machine.
const DAY_MS = 86400000;

export const FIRST_DAY = Date.UTC(1900, 0, 1) / DAY_MS;
export const LAST_DAY = Date.UTC(2100, 11, 31) / DAY_MS;

const pad = (n, width) => String(n).padStart(width, '0');

const lengths = new Map(); // year * 12 + month -> days in that month
export function daysInMonth(y, m) {
  const key = y * 12 + m;
  if (!lengths.has(key)) lengths.set(key, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return lengths.get(key);
}

export function dayNumber(y, m, d) {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function civil(n) {
  const date = new Date(n * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Day number of a YYYY-MM-DD string, or null when it is not a real calendar date from 1900 to 2100. */
export function parseDay(text) {
  const m = typeof text === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  const n = dayNumber(y, mo, d);
  return n < FIRST_DAY || n > LAST_DAY ? null : n;
}

export function formatDay(n) {
  const { y, m, d } = civil(n);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Day of the week of a day number: 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(n) {
  const { y, m, d } = civil(n);
  // Noon, so that an hour skipped or repeated by a clock change cannot move the date.
  return new Date(y, m - 1, d, 12).getDay();
}
