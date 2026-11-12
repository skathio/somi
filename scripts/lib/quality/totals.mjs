// quality/totals.mjs: a touched file's totals. A change may not take a file over a limit, nor add more than the per-change limit at
// once, however its functions are cut up. What it moved in from another file it touched is not added, so splitting a file into modules
// is not refused for its size.

import { report } from './findings.mjs';

// Each total, the limit a change may not take the file over, and the limit on how much one change may add.
const MEASURES = [
  { measure: 'cognitive', over: 'file-cognitive', limit: 'cognitive', added: 'file-added-cognitive', addedLimit: 'added_cognitive' },
  { measure: 'lines', over: 'file-lines', limit: 'lines', added: 'file-added-lines', addedLimit: 'added_lines' },
  { measure: 'functions', over: 'file-functions', limit: 'functions' },
];

// A function's text, trimmed line by line, so the same function moved elsewhere, or indented differently, has the same key.
export const keyOf = (lines, u) => lines.slice(u.start - 1, u.end).map((l) => l.trim()).join('\n');
const countOf = (keys) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());

// A test file grows with the code it tests, so only its complexity is held to the file limits.
function scoreFile(ctx, { file, now, was, moved }) {
  const limits = ctx.limits.file;
  for (const m of ctx.isTest(file) ? MEASURES.slice(0, 1) : MEASURES) {
    if (now[m.measure] > limits[m.limit] && was[m.measure] <= limits[m.limit]) report(ctx, { rule: m.over, file, line: 1, value: now[m.measure], limit: limits[m.limit], before: was[m.measure] });
    const added = now[m.measure] - was[m.measure] - moved[m.measure];
    if (m.added && added > limits[m.addedLimit]) report(ctx, { rule: m.added, file, line: 1, value: added, limit: limits[m.addedLimit], ...(moved[m.measure] > 0 ? { moved: moved[m.measure] } : {}) });
  }
}

// A function is moved, not added, when its file did not have it, the files the change touched did, and it occurs no more often after
// the change than before. A copy occurs more often, and a function changed on the way has a new key, so both still count in full.
export function scoreTotals(ctx) {
  const before = countOf(ctx.moves.before);
  const after = countOf(ctx.moves.after);
  const isMoved = (key) => (before.get(key) ?? 0) >= after.get(key);
  for (const { units, own, ...totals } of ctx.totals) {
    const credited = units.filter((u) => !own.has(u.key) && isMoved(u.key));
    const moved = { cognitive: credited.reduce((s, u) => s + u.cognitive, 0), lines: credited.reduce((s, u) => s + u.lines, 0), functions: credited.length };
    scoreFile(ctx, { ...totals, moved });
  }
}
