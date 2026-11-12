// quality/functions.mjs: one touched function against the limits and against its own old version. A change may not take a function over
// a limit. One that was already over may get a little worse, as SonarQube treats an existing issue, but not by more than the growth
// limit, so an old function cannot keep taking a branch at a time for ever.

import { report } from './findings.mjs';

export const METRICS = ['cognitive', 'depth', 'lines', 'params', 'options'];
const ALLOW = /somi-gate-allow\s+([a-z_-]+)\s+reason="([^"]{20,})"\s+expires=(\d{4}-\d{2}-\d{2})/;
export const MAX_EXEMPTION_DAYS = 90;
const ANONYMOUS = /^<anonymous:(\d+)>$/;

// An exemption sits on the line just above the function. It needs a reason of 20 characters or more and an expiry no more than 90 days
// out. In benchmark mode none counts: an agent writing its own exemption is a violation.
export function exemption(ctx, lines, unit, rule) {
  const m = ALLOW.exec(lines[unit.start - 2] ?? '');
  if (!m || (m[1] !== rule && m[1] !== 'all') || ctx.mode === 'benchmark') return null;
  const expires = Date.parse(`${m[3]}T00:00:00Z`);
  const today = Date.parse(ctx.now);
  if (!(expires >= today) || expires - today > MAX_EXEMPTION_DAYS * 86400000) return null;
  return { reason: m[2], expires: m[3] };
}

// A function is paired with its old version by name and signature first, so a new overload added above an old one is new, not the
// old one got different. What is left is paired by name alone, so a function whose parameters changed is still the same function. An
// anonymous function is named by its line, so its line is traced back through the change first: lines added above it do not make an
// old callback look new.
export function pairUnits(before, after, toOld = (line) => line) {
  const taken = new Set();
  const nameOf = (u) => {
    if (!ANONYMOUS.test(u.name)) return u.name;
    const line = toOld(u.start);
    return line === null ? `<added:${u.start}>` : `<anonymous:${line}>`;
  };
  const match = (u, key) => {
    const old = before.find((b) => !taken.has(b) && key(b, b.name) === key(u, nameOf(u)));
    if (old) taken.add(old);
    return old ?? null;
  };
  const exact = after.map((u) => match(u, (x, name) => `${x.kind}:${name}:${x.signature}`));
  return after.map((u, i) => ({ after: u, before: exact[i] ?? match(u, (x, name) => `${x.kind}:${name}`) }));
}

function overLimit(ctx, { file, lines, after, before, metric, limit }) {
  const allowed = exemption(ctx, lines, after, metric);
  if (allowed) return ctx.exemptions.push({ rule: metric, file, line: after.start, name: after.name, ...allowed });
  return report(ctx, { rule: metric, file, line: after.start, name: after.name, kind: after.kind, value: after[metric], limit, ...(before ? { before: before[metric] } : {}) });
}

/** One touched function, paired with its old version or null. */
export function scoreUnit(ctx, { file, lines, after, before }) {
  ctx.scored.functions += 1;
  for (const metric of METRICS) {
    const limit = ctx.limits[after.kind][metric];
    if (after[metric] <= limit || (before && after[metric] <= before[metric])) continue;
    const growth = ctx.limits.growth[metric];
    const already = before && before[metric] > limit;
    if (already && (growth === undefined || after[metric] - before[metric] <= growth)) {
      ctx.warnings.push({ rule: metric, file, line: after.start, name: after.name, value: after[metric], limit, before: before[metric] });
      continue;
    }
    overLimit(ctx, { file, lines, after, before, metric, limit: already ? before[metric] + growth : limit });
  }
}
