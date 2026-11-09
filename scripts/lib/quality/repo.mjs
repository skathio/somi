// quality/repo.mjs: the whole codebase measured as it stands, for a cleanup or a refactor. Where a change scope asks whether a change made
// things worse, this asks where the debt is: every function and file over a limit, every copy in product code, every suppression with
// no reason, worst first. It is a report, not a gate on a change, so there is no before to compare with and no per-change limit.

import { fileAt, listFiles } from '../git-tree.mjs';
import { findClones, tokensOf } from './clones.mjs';
import { JS_FAMILY, METRICS, exemption, isTest, scoreComments, scoreCss, skipped, total, withTree } from './gate.mjs';
import { topLevelCognitive, unitsOf } from './metrics.mjs';
import { languageOf } from './parse.mjs';

const TOP = 20;

// The change scopes' comment and stylesheet checks, run on every line, since the whole file is what is being measured.
const EVERY_LINE = [[1, Number.MAX_SAFE_INTEGER]];

function unitFindings(ctx, { file, lines, unit }) {
  ctx.scored.functions += 1;
  ctx.functions.push({ file, line: unit.start, name: unit.name, cognitive: unit.cognitive });
  for (const metric of METRICS.filter((m) => unit[m] > ctx.limits[unit.kind][m])) {
    const allowed = exemption(ctx, lines, unit, metric);
    if (allowed) ctx.exemptions.push({ rule: metric, file, line: unit.start, name: unit.name, ...allowed });
    else ctx.violations.push({ rule: metric, file, line: unit.start, name: unit.name, kind: unit.kind, value: unit[metric], limit: ctx.limits[unit.kind][metric] });
  }
}

// A function the parser could not follow is not scored, and with one in the file its total is not trusted either.
function codeFindings(ctx, { file, lines, parsed }) {
  const test = isTest(file);
  const units = unitsOf(parsed.tree, { file, isTest: test });
  const readable = (u) => !parsed.errors.some(([a, b]) => a <= u.end && b >= u.start);
  for (const unit of units.filter(readable)) unitFindings(ctx, { file, lines, unit });
  const sum = total(units, topLevelCognitive(parsed.tree));
  if (parsed.errors.length === 0 && sum > ctx.limits.file.cognitive) ctx.violations.push({ rule: 'file-cognitive', file, line: 1, value: sum, limit: ctx.limits.file.cognitive });
  if (JS_FAMILY.has(parsed.language) && !test) ctx.cloneFiles.push({ file, tokens: tokensOf(parsed.tree), size: ctx.limits.clones.tokens });
}

function scoreParsed(ctx, { file, text, parsed }) {
  if (parsed?.unanalyzed || parsed?.errors.length) ctx.unanalyzed.push({ file, reason: parsed.unanalyzed ?? `the parser could not follow ${parsed.errors.length} part(s)` });
  if (!parsed?.tree) return;
  ctx.scored.files += 1;
  scoreComments(ctx, file, parsed.tree, EVERY_LINE);
  if (parsed.language === 'css') scoreCss(ctx, file, parsed.tree, EVERY_LINE);
  else codeFindings(ctx, { file, lines: text.split('\n'), parsed });
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
    most_findings: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([file, findings]) => ({ file, findings })),
  };
}

/** The codebase at `rev`, measured against `limits`: { ok, violations, exemptions, unanalyzed, scored, summary }. */
export async function repoQuality(root, { rev, limits, now = new Date().toISOString() }) {
  const ctx = { limits, now, mode: 'project', violations: [], exemptions: [], unanalyzed: [], functions: [], cloneFiles: [], scored: { files: 0, functions: 0 } };
  for (const file of listFiles(root, rev).filter((f) => languageOf(f))) {
    const text = fileAt(root, rev, file);
    if (text !== null && !skipped(file, text)) await withTree(file, text, (parsed) => scoreParsed(ctx, { file, text, parsed }));
  }
  for (const c of findClones({ after: ctx.cloneFiles })) ctx.violations.push({ rule: 'clone', file: c.file, line: c.line, value: c.lines, limit: 0, other: c.other });
  return { ok: ctx.violations.length === 0, violations: ctx.violations, exemptions: ctx.exemptions, unanalyzed: ctx.unanalyzed, scored: ctx.scored, summary: summary(ctx) };
}
