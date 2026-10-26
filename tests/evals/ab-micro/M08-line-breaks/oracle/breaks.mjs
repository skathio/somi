// SOMI-CANARY-M08-6d2e9b40a7c1f385
const bad = (Kind, code) => Object.assign(new Kind('invalid input'), { code });

export function breakLines(words, width) {
  if (!Array.isArray(words)) throw bad(TypeError, 'E_TYPE');
  for (const w of words) if (typeof w !== 'string') throw bad(TypeError, 'E_TYPE');
  if (!Number.isInteger(width)) throw bad(TypeError, 'E_TYPE');
  if (width < 1) throw bad(RangeError, 'E_WIDTH');
  for (const w of words) if (w === '' || w.includes(' ')) throw bad(RangeError, 'E_WORD');
  const n = words.length;
  const len = words.map((w) => w.length);
  const best = new Array(n + 1).fill(Infinity);
  const next = new Array(n + 1).fill(n);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    let used = -1;
    for (let j = i + 1; j <= n; j++) {
      used += len[j - 1] + 1;
      if (j - i >= 2 && used > width) break;
      let c;
      if (used > width) c = 0;
      else if (j < n) c = (width - used) ** 2;
      else c = i > 0 && j - i === 1 ? 6 : 0;
      if (c + best[j] <= best[i]) { best[i] = c + best[j]; next[i] = j; }
    }
  }
  const lines = [];
  for (let i = 0; i < n; i = next[i]) lines.push(words.slice(i, next[i]).join(' '));
  return lines;
}
