// SOMI-CANARY-N34-3e68521e8d65af8a
import { HttpError } from './errors.mjs';

const DAY = 86400000;
const HOUR = 3600000;
const formats = new Map();

function formatter(zone) {
  if (!formats.has(zone)) {
    try {
      formats.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    } catch {
      throw new HttpError(400, 'invalid_zone', 'unknown zone');
    }
  }
  return formats.get(zone);
}

// The wall clock at an instant, written as if it were UTC, so wall clocks can be compared and subtracted.
function wall(zone, ms) {
  const p = Object.fromEntries(formatter(zone).formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function firstAfterGap(zone, wanted) {
  let lo = wanted - 16 * HOUR;
  let hi = wanted + 14 * HOUR;
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (wall(zone, mid) >= wanted) hi = mid;
    else lo = mid;
  }
  return hi;
}

function runOn(zone, wanted) {
  const found = [];
  for (const offset of new Set([-1, 1, 0.5, -0.5, 26, 16].map((d) => wall(zone, wanted + d * DAY) - (wanted + d * DAY)).concat(Array.from({ length: 53 }, (_, i) => (i - 26) * HOUR / 2 * 1)))) {
    const at = wanted - offset;
    if (wall(zone, at) === wanted) found.push(at);
  }
  found.sort((a, b) => a - b);
  if (found.length) return found[0];
  return firstAfterGap(zone, wanted);
}

export function nextRun(after, { time, zone }) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time));
  if (!m) throw new HttpError(400, 'invalid_time', 'not HH:MM');
  const today = Math.floor(wall(zone, after) / DAY) * DAY;
  const clock = Number(m[1]) * HOUR + Number(m[2]) * 60000;
  for (let d = -1; d < 4; d++) {
    const run = runOn(zone, today + d * DAY + clock);
    if (run > after) return run;
  }
  throw new Error('no run found');
}
