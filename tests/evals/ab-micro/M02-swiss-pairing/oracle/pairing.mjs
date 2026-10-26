// SOMI-CANARY-M02-6c1f4a9d2e7b8035
const bad = (Kind, code) => Object.assign(new Kind(code), { code });
const isInt = (x) => typeof x === 'number' && Number.isSafeInteger(x);

function validate(players, history) {
  if (!Array.isArray(players) || !Array.isArray(history)) throw bad(TypeError, 'E_TYPE');
  const met = new Map();
  for (const p of players) {
    const ok = p !== null && typeof p === 'object' && !Array.isArray(p) && typeof p.id === 'string' && p.id !== '' && isInt(p.points) && isInt(p.rating) && !met.has(p.id);
    if (!ok) throw bad(RangeError, 'E_PLAYER');
    met.set(p.id, new Set());
  }
  const byes = new Set();
  for (const h of history) {
    if (!Array.isArray(h) || h.length !== 2 || !met.has(h[0]) || h[0] === h[1] || !(h[1] === null || met.has(h[1]))) throw bad(RangeError, 'E_HISTORY');
    if (h[1] === null) byes.add(h[0]);
    else {
      met.get(h[0]).add(h[1]);
      met.get(h[1]).add(h[0]);
    }
  }
  return { met, byes };
}

const outranks = (a, b) => a.points !== b.points ? b.points - a.points : a.rating !== b.rating ? b.rating - a.rating : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function complete(ranked, met) {
  if (ranked.length === 0) return [];
  const [first, ...others] = ranked;
  for (let i = 0; i < others.length; i++) {
    if (met.get(first).has(others[i])) continue;
    const tail = complete(others.filter((_, j) => j !== i), met);
    if (tail) return [[first, others[i]], ...tail];
  }
  return null;
}

export function pairRound(players, history) {
  const { met, byes } = validate(players, history);
  const ranked = [...players].sort(outranks).map((p) => p.id);
  if (ranked.length % 2 === 0) {
    const pairs = complete(ranked, met);
    if (pairs) return pairs;
  } else {
    for (let i = ranked.length - 1; i >= 0; i--) {
      if (byes.has(ranked[i])) continue;
      const pairs = complete(ranked.filter((_, j) => j !== i), met);
      if (pairs) return [...pairs, [ranked[i], null]];
    }
  }
  throw bad(RangeError, 'E_NO_PAIRING');
}
