// SOMI-CANARY-M01-3f9a1c7e5d2b8046
// Independent method: search for the unique slot order that satisfies the stated properties (sum of a pair, the
// round-by-round meeting sums when the better seed always wins, seed 1 first, mirrored slots holding neighbouring best seeds).
const bad = (Kind, code) => Object.assign(new Kind('invalid entrants'), { code });

function blocksHold(best, size) {
  // best[j] = better seed of slot j or 0 when not yet placed; every fully placed aligned block must meet its sums.
  const winner = (lo, len) => {
    if (len === 1) return best[lo];
    const a = winner(lo, len / 2), b = winner(lo + len / 2, len / 2);
    if (a === 0 || b === 0) return 0;
    if (a + b !== size / len + 1) return -1;
    if (lo + len <= best.length / 2 && a > b) return -1;
    return Math.min(a, b);
  };
  for (let len = 2; len <= best.length; len *= 2) for (let lo = 0; lo < best.length; lo += len) if (winner(lo, len) === -1) return false;
  return true;
}

function layout(size) {
  const m = size / 2;
  const best = new Array(m).fill(0);
  const used = new Set();
  const place = (j, seed) => { best[j] = seed; used.add(seed); };
  const lift = (j) => { used.delete(best[j]); best[j] = 0; };
  const mirror = (seed) => (seed % 2 === 1 ? seed + 1 : seed - 1);
  const go = (j) => {
    if (m === 1) return true;
    if (j >= m / 2) return blocksHold(best, size);
    for (let s = 1; s <= m; s++) {
      if (used.has(s) || (j === 0 && s !== 1)) continue;
      const t = mirror(s);
      if (t > m || used.has(t) || t === s) continue;
      place(j, s); place(m - 1 - j, t);
      if (blocksHold(best, size) && go(j + 1)) return true;
      lift(j); lift(m - 1 - j);
    }
    return false;
  };
  if (m === 1) return [1];
  return go(0) ? best.slice() : null;
}

export function seedBracket(entrants) {
  const kinds = entrants === null ? 'null' : typeof entrants;
  if (kinds !== 'object' || !Array.isArray(entrants)) throw bad(TypeError, 'E_TYPE');
  if (entrants.some((e) => !(typeof e === 'string' || (typeof e === 'number' && Number.isFinite(e))))) throw bad(TypeError, 'E_TYPE');
  if (entrants.length < 2) throw bad(RangeError, 'E_COUNT');
  const seen = [];
  for (const e of entrants) { if (seen.some((x) => x === e)) throw bad(RangeError, 'E_DUPLICATE'); seen.push(e); }
  let size = 2;
  while (size < entrants.length) size <<= 1;
  const best = layout(size);
  return best.map((hi) => [entrants[hi - 1], size + 1 - hi > entrants.length ? null : entrants[size - hi]]);
}
