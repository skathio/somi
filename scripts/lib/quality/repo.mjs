// quality/repo.mjs: the whole codebase measured as it stands, for a cleanup or a refactor. Where a change scope asks whether a change made
// things worse, this asks where the debt is: every function and file over a limit, every copy in product code, every suppression with
// no reason, worst first. It is a report, not a gate on a change, so there is no before to compare with and no per-change limit.

import { fileAt, listFiles } from '../git-tree.mjs';
import { findClones, tokensOf } from './clones.mjs';
import { report } from './findings.mjs';
import { METRICS, TOO_DEEP, familyOf, exemption, isTest, scoreComments, scoreCss, skipped, total, withTree } from './gate.mjs';
import { codeLines, topLevelCognitive, unitsOf } from './metrics.mjs';
import { languageOf } from './parse.mjs';
import { pythonFindings } from './python.mjs';

const TOP = 20;
const NEAR = 0.8;

// The change scopes' comment and stylesheet checks, run on every line, since the whole file is what is being measured.
const EVERY_LINE = [[1, Number.MAX_SAFE_INTEGER]];

function unitFindings(ctx, { file, lines, unit }) {
  ctx.scored.functions += 1;
  ctx.functions.push({ file, line: unit.start, name: unit.name, kind: unit.kind, cognitive: unit.cognitive });
  for (const metric of METRICS.filter((m) => unit[m] > ctx.limits[unit.kind][m])) {
    const allowed = exemption(ctx, lines, unit, metric);
    if (allowed) ctx.exemptions.push({ rule: metric, file, line: unit.start, name: unit.name, ...allowed });
    else report(ctx, { rule: metric, file, line: unit.start, name: unit.name, kind: unit.kind, value: unit[metric], limit: ctx.limits[unit.kind][metric] });
  }
}

// A function the parser could not follow is not scored, and with one in the file its total is not trusted either.
function codeFindings(ctx, { file, lines, parsed }) {
  const test = isTest(file);
  const units = unitsOf(parsed.tree, { file, isTest: test });
  const readable = (u) => !parsed.errors.some(([a, b]) => a <= u.end && b >= u.start);
  for (const unit of units.filter(readable)) unitFindings(ctx, { file, lines, unit });
  const sums = { cognitive: total(units, topLevelCognitive(parsed.tree)), lines: codeLines(parsed.tree), functions: units.length };
  for (const measure of parsed.errors.length === 0 ? Object.keys(sums) : []) {
    if (sums[measure] > ctx.limits.file[measure]) report(ctx, { rule: `file-${measure}`, file, line: 1, value: sums[measure], limit: ctx.limits.file[measure] });
  }
  if (parsed.language === 'python') for (const f of pythonFindings(parsed.tree, { test }).filter((x) => x.level === 'violation')) report(ctx, { rule: f.rule, file, line: f.line, name: f.name, value: 1, limit: 0 });
  const family = familyOf(parsed.language);
  if (family && !test) ctx.cloneFiles.push({ file, family, tokens: tokensOf(parsed.tree), size: ctx.limits.clones.tokens });
}

function scoreParsed(ctx, { file, text, parsed }) {
  if (parsed?.unanalyzed || parsed?.errors.length) ctx.unanalyzed.push({ file, reason: parsed.unanalyzed ?? `the parser could not follow ${parsed.errors.length} part(s)` });
  if (!parsed?.tree) return;
  ctx.scored.files += 1;
  scoreComments(ctx, file, parsed.tree, EVERY_LINE);
  if (parsed.language === 'css') scoreCss(ctx, file, parsed.tree, EVERY_LINE);
  else codeFindings(ctx, { file, lines: text.split('\n'), parsed });
}

// Code nested deeper than the measuring walks can follow is unanalyzed rather than ending the report.
function measured(ctx, file, run) {
  try { run(); } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    ctx.unanalyzed.push({ file, reason: TOO_DEEP });
  }
}

function summary(ctx) {
  const byRule = {};
  const byFile = {};
  for (const v of ctx.violations) {
    byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
    byFile[v.file] = (byFile[v.file] ?? 0) + 1;
  }
  return {
    by_rule: byRule,
    most_complex: ctx.functions.sort((a, b) => b.cognitive - a.cognitive).slice(0, TOP),
    // Functions just under the complexity limit. Code shaped to pass a number bunches here, so a reviewer may want to look.
    near_limit: ctx.functions.filter((f) => f.kind === 'function' && f.cognitive >= Math.ceil(ctx.limits.function.cognitive * NEAR) && f.cognitive <= ctx.limits.function.cognitive).length,
    most_findings: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([file, findings]) => ({ file, findings })),
  };
}

/** The codebase at `rev`, measured against `limits`: { ok, violations, warnings, exemptions, unanalyzed, scored, summary }. */
export async function repoQuality(root, { rev, limits, now = new Date().toISOString() }) {
  const ctx = { limits, now, mode: 'project', violations: [], warnings: [], exemptions: [], unanalyzed: [], functions: [], cloneFiles: [], scored: { files: 0, functions: 0 } };
  for (const file of listFiles(root, rev).filter((f) => languageOf(f))) {
    const text = fileAt(root, rev, file);
    if (text !== null && !skipped(file, text)) await withTree(file, text, (parsed) => measured(ctx, file, () => scoreParsed(ctx, { file, text, parsed })));
  }
  for (const family of new Set(ctx.cloneFiles.map((f) => f.family))) {
    for (const c of findClones({ after: ctx.cloneFiles.filter((f) => f.family === family) })) ctx.violations.push({ rule: 'clone', file: c.file, line: c.line, value: c.lines, limit: 0, other: c.other, similarity: c.similarity });
  }
  return { ok: ctx.violations.length === 0, violations: ctx.violations, warnings: ctx.warnings, exemptions: ctx.exemptions, unanalyzed: ctx.unanalyzed, scored: ctx.scored, summary: summary(ctx) };
}
