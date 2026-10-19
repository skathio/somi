// SOMI-CANARY-M06-7c2e91ab40d5f863
// Independent method: walk every calendar day from 1900-01-01 to 2200-12-31 with an explicit day counter (1900-01-01 was a
// Monday, so the weekday is the counter modulo 7). Each month is collected as a list of days, a period is recognised by
// counting months, and the chosen day is found by scanning that list (ordinals counted from both ends), never by formula.
const bad = (Kind, code) => Object.assign(new Kind('invalid recurrence input'), { code });
const finiteNumber = (x) => typeof x === 'number' && Number.isFinite(x);
const plain = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const leap = (y) => (y % 400 === 0 ? true : y % 100 === 0 ? false : y % 4 === 0);
const lengths = (y) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const two = (n) => (n < 10 ? '0' + n : '' + n);
const iso = (y, m, d) => '' + y + '-' + two(m) + '-' + two(d);

function realDate(s) {
  if (typeof s !== 'string' || s.length !== 10 || s[4] !== '-' || s[7] !== '-') return false;
  for (const i of [0, 1, 2, 3, 5, 6, 8, 9]) if (s[i] < '0' || s[i] > '9') return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8));
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= lengths(y)[m - 1];
}
function integerIn(x, lo, hi, notZero) {
  if (!Number.isInteger(x) || x < lo || x > hi) return false;
  return !(notZero && x === 0);
}

function validate(rule, after, count) {
  let typed = plain(rule) && typeof after === 'string' && finiteNumber(count);
  if (typed) {
    typed = typeof rule.freq === 'string' && finiteNumber(rule.interval) && typeof rule.start === 'string';
    if (rule.byDay !== undefined) typed = typed && plain(rule.byDay) && finiteNumber(rule.byDay.nth) && finiteNumber(rule.byDay.weekday);
    if (rule.byMonthDay !== undefined) typed = typed && finiteNumber(rule.byMonthDay);
    if (rule.onMissing !== undefined) typed = typed && typeof rule.onMissing === 'string';
    if (rule.exceptions !== undefined) typed = typed && Array.isArray(rule.exceptions) && rule.exceptions.every((e) => typeof e === 'string');
  }
  if (!typed) throw bad(TypeError, 'E_TYPE');
  let fine = realDate(after) && realDate(rule.start) && ['monthly', 'yearly'].includes(rule.freq);
  fine = fine && integerIn(rule.interval, 1, 120) && integerIn(count, 0, 60);
  if (rule.onMissing !== undefined) fine = fine && ['skip', 'clamp'].includes(rule.onMissing);
  if (rule.exceptions !== undefined) for (const e of rule.exceptions) fine = fine && realDate(e);
  const which = (rule.byDay !== undefined ? 1 : 0) + (rule.byMonthDay !== undefined ? 1 : 0);
  fine = fine && which === 1;
  if (rule.byMonthDay !== undefined) fine = fine && integerIn(rule.byMonthDay, -31, 31, true);
  if (rule.byDay !== undefined) fine = fine && integerIn(rule.byDay.nth, -5, 5, true) && integerIn(rule.byDay.weekday, 0, 6);
  if (!fine) throw bad(RangeError, 'E_RANGE');
}

// days: [{d, wd}] of one month. Returns the chosen day of month or 0.
function choose(days, rule) {
  const clamp = rule.onMissing === 'clamp';
  const fromStart = (rule.byMonthDay ?? rule.byDay.nth) > 0;
  const want = Math.abs(rule.byMonthDay ?? rule.byDay.nth);
  const pool = rule.byMonthDay !== undefined ? days : days.filter((x) => x.wd === rule.byDay.weekday);
  if (pool.length === 0) return 0;
  const order = fromStart ? pool : [...pool].reverse();
  if (want <= order.length) return order[want - 1].d;
  if (!clamp) return 0;
  return order[order.length - 1].d;
}

export function nextOccurrences(rule, afterDate, count) {
  validate(rule, afterDate, count);
  const except = rule.exceptions ?? [];
  const sy = Number(rule.start.slice(0, 4)), sm = Number(rule.start.slice(5, 7));
  const found = [];
  let y = 1900, m = 1, d = 1, wd = 0, days = [];
  const closeMonth = () => {
    const delta = (y - sy) * 12 + (m - sm);
    const onPeriod = rule.freq === 'monthly' ? delta >= 0 && delta % rule.interval === 0 : m === sm && y >= sy && (y - sy) % rule.interval === 0;
    if (!onPeriod) return;
    const pick = choose(days, rule);
    if (pick > 0) found.push(iso(y, m, pick));
  };
  for (;;) {
    days.push({ d, wd });
    if (d === lengths(y)[m - 1]) {
      closeMonth();
      days = [];
      if (y === 2200 && m === 12) break;
      d = 1; m++; if (m === 13) { m = 1; y++; }
    } else d++;
    wd = (wd + 1) % 7;
  }
  const out = [];
  for (const s of found) {
    if (out.length < count && s >= rule.start && s > afterDate && !except.includes(s)) out.push(s);
  }
  return out;
}
