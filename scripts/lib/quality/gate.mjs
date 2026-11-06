// quality/gate.mjs: whether a change meets the quality limits. It scores only what the change touches, against the version before it,
// so an old codebase is not failed on day one and nothing gets worse: a new function must meet the limits, a changed one may not get
// worse while it is over one, and a file may not gain more complexity in one change than the file limit allows, which is what stops a
// function being split apart just to pass. Copied code, stylesheet rules and newly added suppressions are checked in what the change
// added. A file the gate cannot parse fails it, because a change that cannot be measured must not pass as clean.

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
function exemption(lines, unit, rule, now, mode) {
  const m = ALLOW.exec(lines[unit.start - 2] ?? '');
  if (!m || (m[1] !== rule && m[1] !== 'all') || mode === 'benchmark') return null;
  const expires = Date.parse(`${m[3]}T00:00:00Z`);
  const today = Date.parse(now);
  if (!(expires >= today) || expires - today > MAX_EXEMPTION_DAYS * 86400000) return null;
  return { reason: m[2], expires: m[3] };
}

function pairUnits(before, after) {
  const pool = new Map();
  for (const u of before) { const k = `${u.kind}:${u.name}`; pool.set(k, [...(pool.get(k) ?? []), u]); }
  return after.map((u) => ({ after: u, before: pool.get(`${u.kind}:${u.name}`)?.shift() ?? null }));
}

/**
 * The gate's verdict on the change from `from` to `to`: { ok, violations, exemptions, scored, unanalyzed }. Each violation is
 * { rule, file, line, name?, value, limit, before? }.
 */
export async function qualityGate(root, { from, to, limits, now = new Date().toISOString(), mode = 'project', repoFiles = [] }) {
  const violations = [];
  const exemptions = [];
  const unanalyzed = [];
  const scored = { files: 0, functions: 0 };
  const cloneAfter = [];
  const cloneBefore = [];
  const changed = addedRanges(root, from, to);
  for (const [file, { status, added }] of changed) {
    if (status.startsWith('D') || !languageOf(file)) continue;
    const text = fileAt(root, to, file);
    if (text === null || skipped(file, text)) continue;
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
      if (added.some(([a, b]) => i + 1 >= a && i + 1 <= b) && SUPPRESSION.test(line)) violations.push({ rule: 'suppression', file, line: i + 1, value: 1, limit: limits.suppressions.added });
      if (mode === 'benchmark' && added.some(([a, b]) => i + 1 >= a && i + 1 <= b) && /somi-gate-allow/.test(line)) violations.push({ rule: 'exemption', file, line: i + 1, value: 1, limit: 0 });
    }
    const parsed = await parseSource(file, text);
    if (parsed?.unanalyzed) { unanalyzed.push({ file, reason: parsed.unanalyzed }); violations.push({ rule: 'unanalyzed', file, line: 1, value: 1, limit: 0, reason: parsed.unanalyzed }); continue; }
    scored.files += 1;
    if (parsed.language === 'css') {
      for (const r of cssRules(parsed.tree).filter((x) => added.some(([a, b]) => a <= x.end && b >= x.line))) {
        for (const [rule, value] of Object.entries({ nesting: r.nesting, compound: r.compound, ids: r.ids, important: r.important })) {
          if (value > limits.css[rule]) violations.push({ rule: `css-${rule}`, file, line: r.line, value, limit: limits.css[rule] });
        }
      }
      continue;
    }
    const test = isTest(file);
    const units = unitsOf(parsed.tree, { file, isTest: test });
    const oldText = status.startsWith('A') ? null : fileAt(root, from, file);
    const oldParsed = oldText === null ? null : await parseSource(file, oldText);
    const oldUnits = oldParsed?.tree ? unitsOf(oldParsed.tree, { file, isTest: test }) : [];
    for (const { after, before } of pairUnits(oldUnits, units)) {
      if (!touches(after, added)) continue;
      scored.functions += 1;
      for (const metric of METRICS) {
        const limit = limits[after.kind][metric];
        if (after[metric] <= limit || (before && after[metric] <= before[metric])) continue;
        const allowed = exemption(lines, after, metric, now, mode);
        if (allowed) { exemptions.push({ rule: metric, file, line: after.start, name: after.name, ...allowed }); continue; }
        violations.push({ rule: metric, file, line: after.start, name: after.name, kind: after.kind, value: after[metric], limit, ...(before ? { before: before[metric] } : {}) });
      }
    }
    const now_ = total(units, topLevelCognitive(parsed.tree));
    const was = oldParsed?.tree ? total(oldUnits, topLevelCognitive(oldParsed.tree)) : 0;
    if (now_ > limits.file.cognitive && now_ > was) violations.push({ rule: 'file-cognitive', file, line: 1, value: now_, limit: limits.file.cognitive, before: was });
    if (now_ - was > limits.file.added_cognitive) violations.push({ rule: 'file-added-cognitive', file, line: 1, value: now_ - was, limit: limits.file.added_cognitive });
    if (JS_FAMILY.has(parsed.language)) {
      const size = test ? limits.clones.test_tokens : limits.clones.tokens;
      cloneAfter.push({ file, tokens: tokensOf(parsed.tree), size });
      if (oldParsed?.tree) cloneBefore.push({ file, tokens: tokensOf(oldParsed.tree), size });
    }
  }
  // The rest of the repository is what a copy is compared against. Test files are left out of it: copied setup in tests is often benign.
  const touched = new Set(changed.keys());
  const rest = [];
  for (const file of repoFiles.filter((f) => JS_FAMILY.has(languageOf(f)) && !touched.has(f) && !isTest(f) && !SKIPPED.test(f) && !MINIFIED.test(f)).slice(0, MAX_REPO_FILES)) {
    const text = fileAt(root, to, file);
    if (text === null || skipped(file, text)) continue;
    const parsed = await parseSource(file, text);
    if (parsed?.tree) rest.push({ file, tokens: tokensOf(parsed.tree), size: limits.clones.tokens });
  }
  for (const c of findClones({ after: cloneAfter, before: cloneBefore, rest })) violations.push({ rule: 'clone', file: c.file, line: c.line, value: c.lines, limit: 0, other: c.other });
  return { ok: violations.length === 0, violations, exemptions, scored, unanalyzed };
}
