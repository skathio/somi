// SOMI-CANARY-M01-3f9a1c7e5d2b8046
const bad = (Kind, code) => Object.assign(new Kind('invalid entrants'), { code });
const isEntry = (e) => typeof e === 'string' || (typeof e === 'number' && Number.isFinite(e));

export function seedBracket(entrants) {
  if (!Array.isArray(entrants)) throw bad(TypeError, 'E_TYPE');
  for (const e of entrants) if (!isEntry(e)) throw bad(TypeError, 'E_TYPE');
  const n = entrants.length;
  if (n < 2) throw bad(RangeError, 'E_COUNT');
  if (new Set(entrants).size !== n) throw bad(RangeError, 'E_DUPLICATE');
  let size = 2;
  while (size < n) size *= 2;
  const half = size / 4 || 1;
  let std = [1, 2];
  for (let s = 4; s <= size; s *= 2) std = std.flatMap((x) => [x, s + 1 - x]);
  const first = [];
  for (let j = 0; j < half; j++) first.push(Math.min(std[2 * j], std[2 * j + 1]));
  const mirror = (s) => (s % 2 === 1 ? s + 1 : s - 1);
  const best = size === 2 ? [1] : [...first, ...first.map(mirror).reverse()];
  const slots = best.map((hi) => {
    const lo = size + 1 - hi;
    return [entrants[hi - 1], lo > n ? null : entrants[lo - 1]];
  });
  return slots;
}
