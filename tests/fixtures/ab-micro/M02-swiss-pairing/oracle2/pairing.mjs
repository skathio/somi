// SOMI-CANARY-M02-6c1f4a9d2e7b8035
// Independent method: enumerate every bye choice and every perfect matching without pruning, then pick the best by an
// explicit preference: the lowest ranked bye first, then the earliest pair list compared pair by pair in rank positions.
const bad = (Kind, code) => Object.assign(new Kind(code), { code });

export function pairRound(players, history) {
  if (!(players instanceof Array) || !(history instanceof Array)) throw bad(TypeError, 'E_TYPE');
  const seen = [];
  for (const p of players) {
    const shaped = typeof p === 'object' && p && !(p instanceof Array) && typeof p.id === 'string' && p.id.length > 0 &&
      Number.isSafeInteger(p.points) && Number.isSafeInteger(p.rating);
    if (!shaped || seen.includes(p.id)) throw bad(RangeError, 'E_PLAYER');
    seen.push(p.id);
  }
  const hadBye = [];
  const meetings = [];
  for (const h of history) {
    const shaped = h instanceof Array && h.length === 2 && seen.includes(h[0]) && h[0] !== h[1] && (h[1] === null || seen.includes(h[1]));
    if (!shaped) throw bad(RangeError, 'E_HISTORY');
    if (h[1] === null) hadBye.push(h[0]); else meetings.push(h[0] + '\u0000' + h[1], h[1] + '\u0000' + h[0]);
  }
  const order = [...players];
  order.sort((a, b) => (a.points < b.points ? 1 : a.points > b.points ? -1 : a.rating < b.rating ? 1 : a.rating > b.rating ? -1 : a.id < b.id ? -1 : 1));
  const n = order.length;
  const ids = order.map((p) => p.id);
  const allowed = (i, j) => !meetings.includes(ids[i] + '\u0000' + ids[j]);
  // every perfect matching of the given positions, as lists of [i, j] with i < j
  const matchings = (left) => {
    if (left.length === 0) return [[]];
    const out = [];
    for (let k = 1; k < left.length; k++) {
      const rest = left.filter((_, m) => m !== 0 && m !== k);
      for (const m of matchings(rest)) out.push([[left[0], left[k]], ...m]);
    }
    return out;
  };
  const everyone = ids.map((_, i) => i);
  const options = [];
  for (const bye of n % 2 === 1 ? everyone : [-1]) {
    if (bye >= 0 && hadBye.includes(ids[bye])) continue;
    for (const m of matchings(everyone.filter((i) => i !== bye))) if (m.every(([i, j]) => allowed(i, j))) options.push({ bye, m });
  }
  if (options.length === 0) throw bad(RangeError, 'E_NO_PAIRING');
  const better = (x, y) => {
    if (x.bye !== y.bye) return x.bye > y.bye;
    const flat = (o) => o.m.flat();
    const fx = flat(x), fy = flat(y);
    for (let t = 0; t < fx.length; t++) if (fx[t] !== fy[t]) return fx[t] < fy[t];
    return false;
  };
  let best = options[0];
  for (const o of options) if (better(o, best)) best = o;
  const result = best.m.map(([i, j]) => [ids[i], ids[j]]);
  if (best.bye >= 0) result.push([ids[best.bye], null]);
  return result;
}
