// SOMI-CANARY-M07-6c1e90d4a37b25f8
const fail = (Kind, code) => Object.assign(new Kind('invalid input'), { code });
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

export function apportion(populations, seats, options) {
  if (!Array.isArray(populations)) throw fail(TypeError, 'E_TYPE');
  for (const p of populations) if (!isInt(p, 0, 1e9)) throw fail(TypeError, 'E_TYPE');
  if (!isInt(seats, 0, 1000)) throw fail(TypeError, 'E_TYPE');
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) throw fail(TypeError, 'E_TYPE');
  const o = options ?? {};
  if (o.floor !== undefined && !isInt(o.floor, 0, 1000)) throw fail(TypeError, 'E_TYPE');
  if (o.cap !== undefined && !isInt(o.cap, 1, 1000)) throw fail(TypeError, 'E_TYPE');
  if (o.divisor !== undefined && o.divisor !== 'odd' && o.divisor !== 'next') throw fail(TypeError, 'E_TYPE');
  const floor = o.floor === undefined ? 1 : o.floor;
  const cap = o.cap === undefined ? Infinity : o.cap;
  const step = o.divisor === 'next' ? 1 : 2;
  const live = [];
  populations.forEach((p, i) => { if (p > 0) live.push(i); });
  const k = live.length;
  const capacity = k === 0 ? 0 : cap * k;
  if (k * floor > seats || seats > capacity) throw fail(RangeError, 'E_INFEASIBLE');
  const out = populations.map(() => 0);
  for (const i of live) out[i] = floor;
  for (let left = seats - k * floor; left > 0; left--) {
    let best = -1;
    let bestDiv = 0;
    for (const i of live) {
      if (out[i] >= cap) continue;
      const div = step * (out[i] - floor) + 1;
      if (best < 0) { best = i; bestDiv = div; continue; }
      const mine = populations[i] * bestDiv;
      const theirs = populations[best] * div;
      if (mine > theirs || (mine === theirs && populations[i] > populations[best])) { best = i; bestDiv = div; }
    }
    out[best]++;
  }
  return out;
}
