// quality/gate.mjs: whether a change meets the quality limits. It scores only what the change touches, against the version before it,
// so an old codebase is not failed on day one and nothing gets worse: a new function must meet the limits, a changed one may not get
// worse while it is over one, and a file may not gain more complexity in one change than the file limit allows, which is what stops a
// function being split apart just to pass. Copied code, stylesheet rules and newly added suppressions are checked in what the change
// added. A file the gate cannot parse fails it, because a change that cannot be measured must not pass as clean.

import crypto from 'node:crypto';
import { TEST_FILE } from '../signals.mjs';
import { addedRanges, fileAt } from '../git-tree.mjs';
import { findClones, tokensOf } from './clones.mjs';
import { cssRules } from './css.mjs';
import { unitsOf, topLevelCognitive } from './metrics.mjs';
import { languageOf, parseSource } from './parse.mjs';

const SKIPPED = /(^|\/)(node_modules|vendor|dist|build|coverage|\.next|\.somi)\//;
const MINIFIED = /\.min\.(js|css)$/;
const GENERATED = /@generated\b|Code generated .* DO NOT EDIT/;
const SUPPRESSION = /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|NOSONAR|#\s*noqa|\/\/\s*nolint|@SuppressWarnings|#\s*type:\s*ignore|istanbul ignore|c8 ignore|stylelint-disable/;
const ALLOW = /somi-gate-allow\s+([a-z_-]+)\s+reason="([^"]{20,})"\s+expires=(\d{4}-\d{2}-\d{2})/;
export const MAX_EXEMPTION_DAYS = 90;
const METRICS = ['cognitive', 'depth', 'lines', 'params'];
const JS_FAMILY = new Set(['javascript', 'typescript', 'tsx']);
const MAX_REPO_FILES = 3000;

const touches = (unit, ranges) => ranges.some(([a, b]) => a <= unit.end && b >= unit.start);
const isTest = (file) => TEST_FILE.test(file);
const skipped = (file, text) => SKIPPED.test(file) || MINIFIED.test(file) || GENERATED.test(text.split('\n').slice(0, 5).join('\n'));
const total = (units, top) => units.reduce((s, u) => s + u.cognitive, 0) + top;

// An exemption sits on the line just above the function. It needs a reason of 20 characters or more and an expiry no more than 90 days
// out. In benchmark mode none counts: an agent writing its own exemption is a violation.
function exemption(ctx, lines, unit, rule) {
  const m = ALLOW.exec(lines[unit.start - 2] ?? '');
  if (!m || (m[1] !== rule && m[1] !== 'all') || ctx.mode === 'benchmark') return null;
  const expires = Date.parse(`${m[3]}T00:00:00Z`);
  const today = Date.parse(ctx.now);
  if (!(expires >= today) || expires - today > MAX_EXEMPTION_DAYS * 86400000) return null;
  return { reason: m[2], expires: m[3] };
}

function pairUnits(before, after) {
  const pool = new Map();
  for (const u of before) { const k = `${u.kind}:${u.name}`; pool.set(k, [...(pool.get(k) ?? []), u]); }
  return after.map((u) => ({ after: u, before: pool.get(`${u.kind}:${u.name}`)?.shift() ?? null }));
}

const inAdded = (added, line) => added.some(([a, b]) => line >= a && line <= b);
const flag = (ctx, v) => ctx.violations.push(v);

// Lines the change added: a new suppression is a violation, and in a benchmark so is an exemption the agent wrote.
function scoreLines(ctx, file, lines, added) {
  for (const [i, line] of lines.entries()) {
    if (!inAdded(added, i + 1)) continue;
    if (SUPPRESSION.test(line)) flag(ctx, { rule: 'suppression', file, line: i + 1, value: 1, limit: ctx.limits.suppressions.added });
    if (ctx.mode === 'benchmark' && /somi-gate-allow/.test(line)) flag(ctx, { rule: 'exemption', file, line: i + 1, value: 1, limit: 0 });
  }
}

function scoreCss(ctx, file, tree, added) {
  for (const r of cssRules(tree).filter((x) => added.some(([a, b]) => a <= x.end && b >= x.line))) {
    for (const rule of ['nesting', 'compound', 'ids', 'important']) {
      if (r[rule] > ctx.limits.css[rule]) flag(ctx, { rule: `css-${rule}`, file, line: r.line, value: r[rule], limit: ctx.limits.css[rule] });
    }
  }
}

// One touched function: over a limit is a violation if it is new, or if it got worse.
function scoreUnit(ctx, { file, lines, after, before }) {
  ctx.scored.functions += 1;
  for (const metric of METRICS) {
    const limit = ctx.limits[after.kind][metric];
    if (after[metric] <= limit || (before && after[metric] <= before[metric])) continue;
    const allowed = exemption(ctx, lines, after, metric);
    if (allowed) ctx.exemptions.push({ rule: metric, file, line: after.start, name: after.name, ...allowed });
    else flag(ctx, { rule: metric, file, line: after.start, name: after.name, kind: after.kind, value: after[metric], limit, ...(before ? { before: before[metric] } : {}) });
  }
}

// A file may not end over its limit having grown, nor gain more than the per-change limit at once, however its functions are cut up.
function scoreTotals(ctx, file, now, was) {
  if (now > ctx.limits.file.cognitive && now > was) flag(ctx, { rule: 'file-cognitive', file, line: 1, value: now, limit: ctx.limits.file.cognitive, before: was });
  if (now - was > ctx.limits.file.added_cognitive) flag(ctx, { rule: 'file-added-cognitive', file, line: 1, value: now - was, limit: ctx.limits.file.added_cognitive });
}

async function previousVersion(ctx, file, status, test) {
  const text = status.startsWith('A') ? null : fileAt(ctx.root, ctx.from, file);
  const parsed = text === null ? null : await parseSource(file, text);
  if (!parsed?.tree) return { tree: null, units: [], total: 0 };
  const units = unitsOf(parsed.tree, { file, isTest: test });
  return { tree: parsed.tree, units, total: total(units, topLevelCognitive(parsed.tree)) };
}

async function scoreCode(ctx, { file, status, added, lines, tree, language }) {
  const test = isTest(file);
  const units = unitsOf(tree, { file, isTest: test });
  const old = await previousVersion(ctx, file, status, test);
  for (const pair of pairUnits(old.units, units)) if (touches(pair.after, added)) scoreUnit(ctx, { file, lines, ...pair });
  scoreTotals(ctx, file, total(units, topLevelCognitive(tree)), old.total);
  if (!JS_FAMILY.has(language)) return;
  const size = test ? ctx.limits.clones.test_tokens : ctx.limits.clones.tokens;
  ctx.cloneAfter.push({ file, tokens: tokensOf(tree), size });
  if (old.tree) ctx.cloneBefore.push({ file, tokens: tokensOf(old.tree), size });
}

async function scoreFile(ctx, file, { status, added }) {
  if (status.startsWith('D') || !languageOf(file)) return;
  const text = fileAt(ctx.root, ctx.to, file);
  if (text === null || skipped(file, text)) return;
  const lines = text.split('\n');
  scoreLines(ctx, file, lines, added);
  const parsed = await parseSource(file, text);
  if (parsed?.unanalyzed) {
    ctx.unanalyzed.push({ file, reason: parsed.unanalyzed });
    flag(ctx, { rule: 'unanalyzed', file, line: 1, value: 1, limit: 0, reason: parsed.unanalyzed });
    return;
  }
  ctx.scored.files += 1;
  if (parsed.language === 'css') scoreCss(ctx, file, parsed.tree, added);
  else await scoreCode(ctx, { file, status, added, lines, ...parsed });
}

async function cachedTokens(cache, file, text) {
  const key = cache ? `${file}\0${crypto.createHash('sha1').update(text).digest('hex')}` : null;
  if (key && cache.has(key)) return cache.get(key);
  const parsed = await parseSource(file, text);
  const tokens = parsed?.tree ? tokensOf(parsed.tree) : null;
  if (key) cache.set(key, tokens);
  return tokens;
}

// The rest of the repository is what a copy is compared against. Test files are left out of it: copied setup in tests is often benign.
// A caller scoring many changes in one repository can pass a cache, so files it has read once are not parsed again.
async function restOfRepo(ctx, touched) {
  const rest = [];
  const candidates = ctx.repoFiles.filter((f) => JS_FAMILY.has(languageOf(f)) && !touched.has(f) && !isTest(f) && !SKIPPED.test(f) && !MINIFIED.test(f));
  for (const file of candidates.slice(0, MAX_REPO_FILES)) {
    const text = fileAt(ctx.root, ctx.to, file);
    if (text === null || skipped(file, text)) continue;
    const tokens = await cachedTokens(ctx.cache, file, text);
    if (tokens) rest.push({ file, tokens, size: ctx.limits.clones.tokens });
  }
  return rest;
}

/**
 * The gate's verdict on the change from `from` to `to`: { ok, violations, exemptions, scored, unanalyzed }. Each violation is
 * { rule, file, line, name?, value, limit, before? }.
 */
export async function qualityGate(root, { from, to, limits, now = new Date().toISOString(), mode = 'project', repoFiles = [], cache = null }) {
  const ctx = { root, from, to, limits, now, mode, repoFiles, cache, violations: [], exemptions: [], unanalyzed: [], scored: { files: 0, functions: 0 }, cloneAfter: [], cloneBefore: [] };
  const changed = addedRanges(root, from, to);
  for (const [file, change] of changed) await scoreFile(ctx, file, change);
  const rest = await restOfRepo(ctx, new Set(changed.keys()));
  for (const c of findClones({ after: ctx.cloneAfter, before: ctx.cloneBefore, rest })) flag(ctx, { rule: 'clone', file: c.file, line: c.line, value: c.lines, limit: 0, other: c.other });
  return { ok: ctx.violations.length === 0, violations: ctx.violations, exemptions: ctx.exemptions, scored: ctx.scored, unanalyzed: ctx.unanalyzed };
}
