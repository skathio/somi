// SOMI-CANARY-M08-6d2e9b40a7c1f385
const bad = (Kind, code) => Object.assign(new Kind('invalid input'), { code });

// Brute force: every subset of the n-1 gaps is a break placement; keep the cheapest, ties to the earliest longer line.
export function breakLines(words, width) {
  if (!Array.isArray(words)) throw bad(TypeError, 'E_TYPE');
  if (words.some((w) => typeof w !== 'string')) throw bad(TypeError, 'E_TYPE');
  if (typeof width !== 'number' || !Number.isInteger(width)) throw bad(TypeError, 'E_TYPE');
  if (width < 1) throw bad(RangeError, 'E_WIDTH');
  if (words.some((w) => w.length === 0 || w.indexOf(' ') >= 0)) throw bad(RangeError, 'E_WORD');
  const n = words.length;
  if (n === 0) return [];
  let bestCost = Infinity;
  let bestLines = null;
  for (let mask = 0; mask < 2 ** (n - 1); mask++) {
    const lines = [[words[0]]];
    for (let g = 0; g < n - 1; g++) {
      if ((mask >> g) & 1) lines.push([words[g + 1]]); else lines[lines.length - 1].push(words[g + 1]);
    }
    const texts = lines.map((l) => l.join(' '));
    let cost = 0;
    let feasible = true;
    texts.forEach((t, k) => {
      const last = k === texts.length - 1;
      if (lines[k].length > 1 && t.length > width) feasible = false;
      else if (t.length > width) cost += 0;
      else if (!last) cost += (width - t.length) * (width - t.length);
      else if (texts.length > 1 && lines[k].length === 1) cost += 6;
    });
    if (!feasible) continue;
    let better = cost < bestCost;
    if (cost === bestCost) {
      for (let k = 0; k < Math.min(texts.length, bestLines.length); k++) {
        if (texts[k].length !== bestLines[k].length) { better = texts[k].length > bestLines[k].length; break; }
      }
    }
    if (better) { bestCost = cost; bestLines = texts; }
  }
  return bestLines;
}
