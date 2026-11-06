// SOMI-CANARY-N34-3e68521e8d65af8a
import { HttpError } from './errors.mjs';

const MIN = 60000;

function makeClock(zone) {
  let f;
  try {
    f = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' });
  } catch {
    throw new HttpError(400, 'invalid_zone', 'unknown zone');
  }
  return (ms) => f.format(ms);
}

// Walks the clock a minute at a time, which is slow and obviously right.
export function nextRun(after, { time, zone }) {
  if (typeof time !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) throw new HttpError(400, 'invalid_time', 'not HH:MM');
  const read = makeClock(zone);
  const dates = (from, to) => { const out = []; for (let d = Date.parse(from.slice(0, 10) + 'T00:00Z'); d <= Date.parse(to.slice(0, 10) + 'T00:00Z'); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10)); return out; };
  for (let at = (Math.floor(after / MIN) + 1) * MIN, end = at + 72 * 60 * MIN; at < end; at += MIN) {
    const now = read(at);
    const before = read(at - MIN);
    if (now.slice(11) === time) {
      let repeat = false;
      for (let back = 1; back <= 180 && !repeat; back++) repeat = read(at - back * MIN) === now;
      if (!repeat) return at;
    }
    if (now > before) {
      const skippedOver = dates(before, now).some((day) => { const w = `${day} ${time}`; return w > before && w < now; });
      const stepped = Date.parse(now.replace(' ', 'T') + 'Z') - Date.parse(before.replace(' ', 'T') + 'Z');
      if (stepped > MIN && skippedOver) return at;
    }
  }
  throw new Error('no run found');
}
