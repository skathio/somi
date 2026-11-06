// SOMI-CANARY-M05-8c41e07b92d5a3f6
// Independent method: every possible round (a matching with orientations) is listed and sorted, then rounds are chosen in
// order by depth-first search; each prefix is re-validated from scratch against the written rules.
const bad = (Kind, code) => Object.assign(new Kind('invalid teams'), { code });

function matchings(free) {
  if (free.length === 0) return [[]];
  const [a, ...rest] = free, all = [];
  for (let i = 0; i < rest.length; i++) {
    const others = rest.filter((_, j) => j !== i);
    for (const m of matchings(others)) all.push([[a, rest[i]], ...m]);
  }
  return all;
}
const orient = (m) => m.reduce((acc, [x, y]) => acc.flatMap((p) => [[...p, [x, y]], [...p, [y, x]]]), [[]]);
const cmpMatch = (p, q) => p[0] - q[0] || p[1] - q[1];
const cmpRound = (r, s) => { for (let i = 0; i < r.length; i++) { const c = cmpMatch(r[i], s[i]); if (c) return c; } return 0; };

const memo = {};

export function schedule(teams) {
  if (!Array.isArray(teams)) throw bad(TypeError, 'E_TYPE');
  if (teams.some((t) => typeof t !== 'string')) throw bad(TypeError, 'E_TYPE');
  const n = teams.length;
  if (n < 2 || n > 8) throw bad(RangeError, 'E_COUNT');
  if (new Set(teams).size !== n) throw bad(RangeError, 'E_DUPLICATE');
  const ids = [...teams.keys()], need = n % 2 ? n : n - 1;
  const sets = n % 2 ? ids.map((r) => ids.filter((x) => x !== r)) : [ids];
  const options = sets.flatMap((s) => matchings(s).flatMap(orient))
    .map((r) => r.slice().sort((p, q) => Math.min(...p) - Math.min(...q))).sort(cmpRound);
  const games = n - 1;
  const valid = (rounds, final) => {
    const seen = new Set(), homes = Array(n).fill(0), played = Array(n).fill(0), rests = new Set();
    const streak = Array(n).fill(0);
    for (const rd of rounds) {
      const inRound = new Set(rd.flat());
      for (const t of ids) if (!inRound.has(t) && n % 2) { if (rests.has(t)) return false; rests.add(t); }
      for (const [h, a] of rd) {
        const id = Math.min(h, a) * 100 + Math.max(h, a);
        if (seen.has(id)) return false;
        seen.add(id); homes[h]++; played[h]++; played[a]++; streak[h]++; streak[a] = 0;
        if (streak[h] > 2) return false;
      }
    }
    for (const x of ids) for (const y of ids) if (homes[x] - (homes[y] + games - played[y]) > 1) return false;
    return !final || Math.max(...homes) - Math.min(...homes) <= 1;
  };
  const pick = (rounds) => {
    if (rounds.length === need) return valid(rounds, true) ? rounds : null;
    for (const o of options) {
      const next = [...rounds, o];
      if (!valid(next, false)) continue;
      const done = pick(next);
      if (done) return done;
    }
    return null;
  };
  const best = (memo[n] ??= pick([]));
  return best.map((rd) => {
    const used = new Set(rd.flat());
    return { matches: rd.map(([h, a]) => [teams[h], teams[a]]), rest: n % 2 ? teams[ids.find((t) => !used.has(t))] : null };
  });
}
