// SOMI-CANARY-M03-7c1e49a2d58b306f
// Independent method: pairwise comparison. In one ballot a candidate earns 2 for every other candidate it ranks strictly
// above and 1 for every other candidate it ties with (twice the points), summed in exact BigInt rationals.
const err = (code) => Object.assign(new TypeError('bad input'), { code });
const big = (a, b) => (b === 0n ? a : big(b, a % b));

function checkShape(v, depth) {
  if (depth === 3) { if (typeof v !== 'string') throw err('E_TYPE'); return; }
  if (!Array.isArray(v)) throw err('E_TYPE');
  for (let i = 0; i < v.length; i++) checkShape(v[i], depth + 1);
}

export function aggregate(ballots) {
  checkShape(ballots, 0);
  const ranks = ballots.map((ballot) => {
    const rank = new Map();
    ballot.forEach((tier, level) => tier.forEach((id) => {
      if (rank.has(id)) throw err('E_BALLOT');
      rank.set(id, level);
    }));
    return rank;
  });
  const names = [...new Set(ballots.flat(2))];
  const entries = names.map((id) => {
    let twice = 0n;
    for (let b = 0; b < ranks.length; b++) {
      const mine = ranks[b].has(id) ? ranks[b].get(id) : ballots[b].length;
      for (const other of names) {
        if (other === id) continue;
        const theirs = ranks[b].has(other) ? ranks[b].get(other) : ballots[b].length;
        if (mine < theirs) twice += 2n;
        else if (mine === theirs) twice += 1n;
      }
    }
    let n = twice, d = 2n * BigInt(ballots.length);
    const g = big(n, d);
    n /= g; d /= g;
    return { id, n, d };
  });
  const out = [];
  for (const e of entries) {
    let at = out.length;
    while (at > 0) {
      const f = out[at - 1];
      const lhs = e.n * f.d, rhs = f.n * e.d;
      if (lhs > rhs || (lhs === rhs && [e.id, f.id].sort()[0] === e.id)) at--; else break;
    }
    out.splice(at, 0, e);
  }
  return out.map((e) => ({ id: e.id, num: Number(e.n), den: Number(e.d) }));
}
