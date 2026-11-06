// SOMI-CANARY-M07-6c1e90d4a37b25f8
// Independent method: enumerate every array of seat counts within the stated bounds that sums to seats, and keep the one that
// is stable: no single seat can move from a region to another one whose next claim outranks the claim the seat was given for.
// The claim of a region holding s seats beyond its floor is the BigInt fraction population / divisor(s) with the stated
// preference order. Exactly one stable array exists (claims of a region strictly decrease), no stable array means infeasible.
const fail = (Kind, code) => Object.assign(new Kind('invalid input'), { code });
const okInt = (x, lo, hi) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

export function apportion(populations, seats, options) {
  if (!Array.isArray(populations) || !populations.every((p) => okInt(p, 0, 1e9))) throw fail(TypeError, 'E_TYPE');
  if (!okInt(seats, 0, 1000)) throw fail(TypeError, 'E_TYPE');
  const isObj = options === undefined || (typeof options === 'object' && options !== null && !Array.isArray(options));
  if (!isObj) throw fail(TypeError, 'E_TYPE');
  const get = (name) => (options === undefined ? undefined : options[name]);
  const f = get('floor'), c = get('cap'), d = get('divisor');
  if ((f !== undefined && !okInt(f, 0, 1000)) || (c !== undefined && !okInt(c, 1, 1000)) || (d !== undefined && d !== 'odd' && d !== 'next')) throw fail(TypeError, 'E_TYPE');
  const floor = f === undefined ? 1 : f;
  const cap = c === undefined ? 1e9 : c;
  const mult = d === 'next' ? 1 : 2;
  const live = populations.map((p, i) => i).filter((i) => populations[i] > 0);
  // true when claim (region a at x extra seats) outranks claim (region b at y extra seats)
  const beats = (a, x, b, y) => {
    const l = BigInt(populations[a]) * BigInt(mult * y + 1), r = BigInt(populations[b]) * BigInt(mult * x + 1);
    if (l !== r) return l > r;
    if (populations[a] !== populations[b]) return populations[a] > populations[b];
    return a < b;
  };
  const found = [];
  const seats_ = new Array(live.length).fill(0);
  const walk = (at, left) => {
    if (at === live.length) { if (left === 0) found.push(seats_.slice()); return; }
    for (let s = floor; s <= cap && s <= left; s++) { seats_[at] = s; walk(at + 1, left - s); }
  };
  walk(0, seats);
  const stable = found.filter((x) => {
    for (let a = 0; a < live.length; a++) {
      if (x[a] <= floor) continue;
      for (let b = 0; b < live.length; b++) {
        if (a === b || x[b] >= cap) continue;
        // a's last claim (extra x[a]-floor-1) must outrank b's next claim (extra x[b]-floor)
        if (!beats(live[a], x[a] - floor - 1, live[b], x[b] - floor)) return false;
      }
    }
    return true;
  });
  if (found.length === 0) throw fail(RangeError, 'E_INFEASIBLE');
  if (stable.length !== 1) throw new Error('not unique: ' + stable.length);
  const out = populations.map(() => 0);
  live.forEach((i, j) => { out[i] = stable[0][j]; });
  return out;
}
