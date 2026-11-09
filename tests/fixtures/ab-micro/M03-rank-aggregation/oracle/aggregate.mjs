// SOMI-CANARY-M03-7c1e49a2d58b306f
const bad = (code) => Object.assign(new TypeError('invalid ballots'), { code });
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

export function aggregate(ballots) {
  if (!Array.isArray(ballots)) throw bad('E_TYPE');
  for (const ballot of ballots) {
    if (!Array.isArray(ballot)) throw bad('E_TYPE');
    for (const tier of ballot) {
      if (!Array.isArray(tier)) throw bad('E_TYPE');
      for (const id of tier) if (typeof id !== 'string') throw bad('E_TYPE');
    }
  }
  for (const ballot of ballots) {
    const seen = new Set();
    for (const id of ballot.flat()) {
      if (seen.has(id)) throw bad('E_BALLOT');
      seen.add(id);
    }
  }
  const all = new Set(ballots.flat(2));
  const C = all.size;
  const twice = new Map([...all].map((id) => [id, 0]));
  for (const ballot of ballots) {
    let p = 0;
    for (const tier of ballot) {
      for (const id of tier) twice.set(id, twice.get(id) + 2 * (C - p) - tier.length - 1);
      p += tier.length;
    }
    const named = new Set(ballot.flat());
    for (const id of all) if (!named.has(id)) twice.set(id, twice.get(id) + (C - p) - 1);
  }
  const rows = [...all].map((id) => {
    const num = twice.get(id);
    const den = 2 * ballots.length;
    const g = gcd(num, den);
    return { id, num: num / g, den: den / g };
  });
  rows.sort((a, b) => b.num * a.den - a.num * b.den || (a.id < b.id ? -1 : 1));
  return rows;
}
