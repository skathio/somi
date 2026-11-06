// quality/gate.mjs: whether a change meets the quality limits. It scores only what the change touches, against the version before it,
// so an old codebase is not failed on day one: a change may not take a function or a file over a limit, and a file may not gain more
// complexity in one change than its per-change limit, which is what stops a function being split apart just to pass. A function that
// was already over and got worse is reported as a warning. Copied code, stylesheet rules and newly added suppressions are checked in
// what the change added. A change the parser cannot follow fails, because a change that cannot be measured must not pass as clean.

import crypto from 'node:crypto';
import { TEST_FILE } from '../signals.mjs';
import { addedRanges, fileAt } from '../git-tree.mjs';
import { findClones, tokensOf } from './clones.mjs';
import { cssRules } from './css.mjs';
import { unitsOf, topLevelCognitive } from './metrics.mjs';
import { languageOf, parseSource } from './parse.mjs';

// Code that is not the product: dependencies, build output, and docs, examples and playgrounds, which are written to be read once.
const SKIPPED = /(^|\/)(node_modules|vendor|dist|build|coverage|\.next|\.somi|docs?|examples?|demos?|playgrounds?)\//;
const MINIFIED = /\.min\.(js|css)$/;
const GENERATED = /@generated\b|Code generated .* DO NOT EDIT/;
const SUPPRESSION = /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|NOSONAR|#\s*noqa|\/\/\s*nolint|@SuppressWarnings|#\s*type:\s*ignore|istanbul ignore|c8 ignore|stylelint-disable/;
// A suppression that says why, the way ESLint's -- description or text after @ts-expect-error does, is a decision rather than a
// shortcut. Outside a benchmark it passes.
const REASONED = /eslint-disable[^\n]*\s--\s+\S.{8,}|@ts-(expect-error|ignore)\s*:?\s+\S.{8,}|stylelint-disable[^\n]*\s--\s+\S.{8,}/;
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
    if (SUPPRESSION.test(line) && (ctx.mode === 'benchmark' || !REASONED.test(line))) flag(ctx, { rule: 'suppression', file, line: i + 1, value: 1, limit: ctx.limits.suppressions.added });
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

// One touched function. A change that takes it over a limit is a violation, whether it is new or was within the limit before. One that
// was already over and got worse is a warning: well-kept projects add a branch to a complex function every week, and SonarQube does
// not count that as a new issue either. The file's per-change limit still caps how much any change may add.
function scoreUnit(ctx, { file, lines, after, before }) {
  ctx.scored.functions += 1;
  for (const metric of METRICS) {
    const limit = ctx.limits[after.kind][metric];
    if (after[metric] <= limit || (before && after[metric] <= before[metric])) continue;
    if (before && before[metric] > limit) { ctx.warnings.push({ rule: metric, file, line: after.start, name: after.name, value: after[metric], limit, before: before[metric] }); continue; }
    const allowed = exemption(ctx, lines, after, metric);
    if (allowed) ctx.exemptions.push({ rule: metric, file, line: after.start, name: after.name, ...allowed });
    else flag(ctx, { rule: metric, file, line: after.start, name: after.name, kind: after.kind, value: after[metric], limit, ...(before ? { before: before[metric] } : {}) });
  }
}

// A change may not take a file over its limit, nor add more than the per-change limit at once, however its functions are cut up.
function scoreTotals(ctx, file, now, was) {
  if (now > ctx.limits.file.cognitive && was <= ctx.limits.file.cognitive) flag(ctx, { rule: 'file-cognitive', file, line: 1, value: now, limit: ctx.limits.file.cognitive, before: was });
  if (now - was > ctx.limits.file.added_cognitive) flag(ctx, { rule: 'file-added-cognitive', file, line: 1, value: now - was, limit: ctx.limits.file.added_cognitive });
}

// A tree lives in the parser's WebAssembly memory, which the garbage collector does not free, so each one is deleted as soon as what
// the gate needs has been taken from it. Without that a large repository fills the memory and the runtime aborts.
async function withTree(file, text, read) {
  const parsed = await parseSource(file, text);
  try { return read(parsed); } finally { parsed?.tree?.delete(); }
}

async function previousVersion(ctx, file, status, test) {
  const text = status.startsWith('A') ? null : fileAt(ctx.root, ctx.from, file);
  if (text === null) return { units: [], total: 0, tokens: null };
  return withTree(file, text, (parsed) => {
    if (!parsed?.tree) return { units: [], total: 0, tokens: null };
    const units = unitsOf(parsed.tree, { file, isTest: test });
    return { units, total: total(units, topLevelCognitive(parsed.tree)), tokens: JS_FAMILY.has(parsed.language) && !test ? tokensOf(parsed.tree) : null };
  });
}

async function scoreCode(ctx, { file, status, added, lines, tree, language, errors }) {
  const test = isTest(file);
  const units = unitsOf(tree, { file, isTest: test });
  const old = await previousVersion(ctx, file, status, test);
  // A function the parser could not follow is not scored, and with any such function the file's total is not trusted either.
  const readable = (u) => !errors.some(([a, b]) => a <= u.end && b >= u.start);
  for (const pair of pairUnits(old.units, units)) if (touches(pair.after, added) && readable(pair.after)) scoreUnit(ctx, { file, lines, ...pair });
  if (errors.length === 0) scoreTotals(ctx, file, total(units, topLevelCognitive(tree)), old.total);
  // Copies are looked for in product code. Copied setup between tests is mostly benign (Kapser and Godfrey), and it was most of the
  // false alarms on known-good projects.
  if (!JS_FAMILY.has(language) || test) return;
  const size = ctx.limits.clones.tokens;
  ctx.cloneAfter.push({ file, tokens: tokensOf(tree), size });
  if (old.tokens) ctx.cloneBefore.push({ file, tokens: old.tokens, size });
}

async function scoreFile(ctx, file, { status, added }) {
  if (status.startsWith('D') || !languageOf(file)) return;
  const text = fileAt(ctx.root, ctx.to, file);
  if (text === null || skipped(file, text)) return;
  const lines = text.split('\n');
  scoreLines(ctx, file, lines, added);
  const parsed = await parseSource(file, text);
  try { await scoreParsed(ctx, { file, status, added, lines, parsed }); } finally { parsed?.tree?.delete(); }
}

async function scoreParsed(ctx, { file, status, added, lines, parsed }) {
  // A change the parser cannot follow cannot be measured, so it must not pass as clean. An error elsewhere in the file only stops the
  // functions it sits in from being scored.
  const unreadable = parsed?.unanalyzed ?? (parsed.errors.some(([a, b]) => added.some(([x, y]) => a <= y && b >= x)) ? 'the parser could not follow the changed lines' : null);
  // In a project this is a warning: a grammar can lag valid new syntax, and failing correct code on that would teach people to ignore
  // the gate. In a benchmark it fails, so an agent cannot pass by writing what the gate cannot read.
  if (unreadable) {
    ctx.unanalyzed.push({ file, reason: unreadable });
    const finding = { rule: 'unanalyzed', file, line: 1, value: 1, limit: 0, reason: unreadable };
    if (ctx.mode === 'benchmark') flag(ctx, finding); else ctx.warnings.push(finding);
    return;
  }
  ctx.scored.files += 1;
  if (parsed.language === 'css') scoreCss(ctx, file, parsed.tree, added);
  else await scoreCode(ctx, { file, status, added, lines, ...parsed });
}

async function cachedTokens(cache, file, text) {
  const key = cache ? `${file}\0${crypto.createHash('sha1').update(text).digest('hex')}` : null;
  if (key && cache.has(key)) return cache.get(key);
  const tokens = await withTree(file, text, (parsed) => (parsed?.tree ? tokensOf(parsed.tree) : null));
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
 * The gate's verdict on the change from `from` to `to`: { ok, violations, warnings, exemptions, scored, unanalyzed }. Each violation is
 * { rule, file, line, name?, value, limit, before? }.
 */
export async function qualityGate(root, { from, to, limits, now = new Date().toISOString(), mode = 'project', repoFiles = [], cache = null }) {
  const ctx = { root, from, to, limits, now, mode, repoFiles, cache, violations: [], warnings: [], exemptions: [], unanalyzed: [], scored: { files: 0, functions: 0 }, cloneAfter: [], cloneBefore: [] };
  const changed = addedRanges(root, from, to);
  for (const [file, change] of changed) await scoreFile(ctx, file, change);
  const rest = await restOfRepo(ctx, new Set(changed.keys()));
  for (const c of findClones({ after: ctx.cloneAfter, before: ctx.cloneBefore, rest })) flag(ctx, { rule: 'clone', file: c.file, line: c.line, value: c.lines, limit: 0, other: c.other });
  return { ok: ctx.violations.length === 0, violations: ctx.violations, warnings: ctx.warnings, exemptions: ctx.exemptions, scored: ctx.scored, unanalyzed: ctx.unanalyzed };
}
