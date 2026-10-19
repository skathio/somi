// SOMI-CANARY-M06-7c2e91ab40d5f863
const bad = (Kind, code) => Object.assign(new Kind('invalid recurrence input'), { code });
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isLeap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const dim = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const weekday = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
const fmt = (y, m, d) => String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const dateOk = (s) => {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return p !== null && +p[1] >= 1900 && +p[1] <= 2200 && +p[2] >= 1 && +p[2] <= 12 && +p[3] >= 1 && +p[3] <= dim(+p[1], +p[2]);
};
const inRange = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

function check(rule, after, count) {
  const { freq, interval, start, byDay, byMonthDay, onMissing, exceptions } = isObj(rule) ? rule : {};
  const types = isObj(rule) && typeof after === 'string' && isNum(count) && typeof freq === 'string' && isNum(interval) && typeof start === 'string'
    && (byDay === undefined || (isObj(byDay) && isNum(byDay.nth) && isNum(byDay.weekday)))
    && (byMonthDay === undefined || isNum(byMonthDay)) && (onMissing === undefined || typeof onMissing === 'string')
    && (exceptions === undefined || (Array.isArray(exceptions) && exceptions.every((e) => typeof e === 'string')));
  if (!types) throw bad(TypeError, 'E_TYPE');
  const ranges = dateOk(after) && dateOk(start) && (exceptions ?? []).every(dateOk) && (freq === 'monthly' || freq === 'yearly')
    && inRange(interval, 1, 120) && inRange(count, 0, 60) && (onMissing === undefined || onMissing === 'skip' || onMissing === 'clamp')
    && (byDay === undefined) !== (byMonthDay === undefined)
    && (byMonthDay === undefined || (inRange(byMonthDay, -31, 31) && byMonthDay !== 0))
    && (byDay === undefined || (inRange(byDay.nth, -5, 5) && byDay.nth !== 0 && inRange(byDay.weekday, 0, 6)));
  if (!ranges) throw bad(RangeError, 'E_RANGE');
}

// The day of month chosen in period (y, m), or 0 when the period yields nothing.
function pick(y, m, rule) {
  const n = dim(y, m), clamp = rule.onMissing === 'clamp';
  if (rule.byMonthDay !== undefined) {
    const k = rule.byMonthDay, pos = k > 0 ? k : n + 1 + k;
    if (pos >= 1 && pos <= n) return pos;
    return clamp ? (k > 0 ? n : 1) : 0;
  }
  const { nth, weekday: wd } = rule.byDay;
  const first = 1 + ((wd - weekday(y, m, 1) + 7) % 7), total = Math.floor((n - first) / 7) + 1;
  const idx = nth > 0 ? nth : total + 1 + nth;
  if (idx >= 1 && idx <= total) return first + 7 * (idx - 1);
  if (!clamp) return 0;
  return nth > 0 ? first + 7 * (total - 1) : first;
}

export function nextOccurrences(rule, afterDate, count) {
  check(rule, afterDate, count);
  const skip = new Set(rule.exceptions ?? []);
  const base = +rule.start.slice(0, 4) * 12 + +rule.start.slice(5, 7) - 1;
  const step = rule.freq === 'yearly' ? 12 * rule.interval : rule.interval;
  const out = [];
  for (let k = 0; out.length < count; k++) {
    const idx = base + k * step, y = Math.floor(idx / 12), m = (idx % 12) + 1;
    if (y > 2200) break;
    const d = pick(y, m, rule);
    if (d === 0) continue;
    const iso = fmt(y, m, d);
    if (iso < rule.start || iso <= afterDate || skip.has(iso)) continue;
    out.push(iso);
  }
  return out;
}
