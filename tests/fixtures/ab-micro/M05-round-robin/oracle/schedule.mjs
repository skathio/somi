// SOMI-CANARY-M05-8c41e07b92d5a3f6
const bad = (Kind, code) => Object.assign(new Kind('invalid teams'), { code });

export function schedule(teams) {
  if (!Array.isArray(teams)) throw bad(TypeError, 'E_TYPE');
  for (const t of teams) if (typeof t !== 'string') throw bad(TypeError, 'E_TYPE');
  const n = teams.length;
  if (n < 2 || n > 8) throw bad(RangeError, 'E_COUNT');
  if (new Set(teams).size !== n) throw bad(RangeError, 'E_DUPLICATE');
  const odd = n % 2, k = n >> 1, rounds = odd ? n : n - 1, cap = odd ? (n - 1) / 2 : n / 2;
  const met = Array.from({ length: n }, () => Array(n).fill(false));
  const last = Array(n).fill(-1), rested = Array(n).fill(false);
  const home = Array(n).fill(0), away = Array(n).fill(0), run = Array(n).fill(0);
  const out = [], restOf = [];
  const go = (r, pos, prevMin) => {
    if (r === rounds) return true;
    for (let h = 0; h < n; h++) for (let a = 0; a < n; a++) {
      if (h === a || last[h] === r || last[a] === r || met[h][a]) continue;
      const m = Math.min(h, a);
      if (m <= prevMin || home[h] >= cap || away[a] >= cap || run[h] >= 2) continue;
      let skipped = 0, skipOk = true;
      for (let t = 0; t < m; t++) if (last[t] !== r) { skipped++; if (rested[t]) skipOk = false; }
      if (skipped > odd || !skipOk) continue;
      const [lh, la, ra] = [last[h], last[a], run[a]];
      met[h][a] = met[a][h] = true; last[h] = last[a] = r;
      home[h]++; away[a]++; run[h]++; run[a] = 0; out.push([h, a]);
      let rest = -1, ok = true;
      if (pos === k - 1 && odd) { rest = last.findIndex((x) => x !== r); ok = !rested[rest]; if (ok) { rested[rest] = true; restOf[r] = rest; } }
      if (ok && (pos === k - 1 ? go(r + 1, 0, -1) : go(r, pos + 1, m))) return true;
      if (rest >= 0 && ok) rested[rest] = false;
      out.pop(); run[a] = ra; run[h]--; home[h]--; away[a]--;
      last[h] = lh; last[a] = la; met[h][a] = met[a][h] = false;
    }
    return false;
  };
  go(0, 0, -1);
  return Array.from({ length: rounds }, (_, r) => ({
    matches: out.slice(r * k, r * k + k).map(([h, a]) => [teams[h], teams[a]]),
    rest: odd ? teams[restOf[r]] : null,
  }));
}
