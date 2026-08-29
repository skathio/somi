#!/usr/bin/env node
// tests/evals/lib/classification.mjs — decisions.md#d11's settled gating classification, as data
// (phase 2, iteration 2.4a).
//
// This file lands ONE table and nothing else. `run.mjs`'s `SCOPES`/`CERTIFY` are untouched here on
// purpose — plan review pass 3 found that wiring a budget sized for this table's dimension count
// against `buildResult()`'s still-unwired (13-dimension) output produces an incoherent gate that
// rejects a healthy corpus ~48% of the time. Wiring `CLASSIFICATION` into `buildResult`/`certify`/
// `compare` is 2.4b's job, not this one's. Nothing here is imported by `run.mjs`.
//
// WHAT "gating" MEANS: `decisions.md#d11`'s two-part rule, applied without exception — a criterion
// is gating only if (1) bidirectional (its executor can independently produce both `pass` and
// `fail` from the artifact alone, no draw resting on a judge-authored `pass`) AND (2) sound (that
// verdict comes from complete enumeration over a closed input, not pattern search over open-ended
// content). A (task, dimension) pair gates only if EVERY criterion tagged with it, within that
// task, is individually gating — clause 1's own aggregation rule, no carve-out. `dimensionVerdict`
// below applies exactly that, and nothing else.
//
// THE DRIFT CHECK, AND ITS KNOWN LIMITS (pass 2 F-84/F-85 fixed the append-order mechanism; pass 3
// F-88 closed a fail-open on the verdict cell — an unrecognized spelling now throws rather than
// being silently dropped; not asserted exhaustive, see `eval-runner.sh`'s self-checks for coverage).
// `decisionsMdClassification()` derives this table from `decisions.md#d11`'s own markdown,
// independent of the array below (`eval-runner.sh` runs the diff both ways: mutating either side
// alone goes red). D11's five corrections to date have every one of them been APPENDED as a new
// dated section, never an edit in place — so the parser scans the WHOLE D11 entry for every
// classification-shaped table, in document order, and a (task, criterion) key asserted by more than
// one table takes its LAST table's row. That makes a later correction override an earlier one
// automatically (fixes F-84: a sixth appended correction is picked up), and makes the settled
// table's `01|6` — which D11 itself calls "superseding the 3-dimension count throughout this entry
// above" — win over the original's copy (fixes F-85: it used to be the reverse). Known gaps:
// 1. **Environment**: `.somi/` is gitignored repo-wide (`scripts/check-links.mjs`'s own header:
//    "`git ls-files` can never produce a path inside it") — `decisions.md` exists only on a
//    machine actively working this plan, never in CI or a clean checkout. `eval-runner.sh` skips
//    the comparison loudly, not silently, when the file is absent.
// 2. **A second renumbering**: D11's 2026-08-09 correction renumbered task 02's criteria once
//    (`TASK02_STABLE_RENUMBER` below encodes it, applied only to the FIRST table found — the only
//    one still using the old numbers). A second renumbering would need the same kind of
//    hand-written remap; nothing here infers one from prose.
// 3. **Deletion**: a correction saying "this row no longer applies," without restating it under a
//    verdict, isn't representable by appending rows — the mechanism can make a later statement
//    win, not notice a row's absence being asserted in prose.
// 4. **Structural truncation** (disclosed, not fixed): a `## ` line in D11's prose ends the
//    scanned span; past the settled table it can silently drop a still-later correction. None today.
//
// The always-on tests (`diffClassification` against synthetic tables; `decisionsMdClassification`
// against a synthetic multi-table span) prove the mechanism catches a changed verdict, a missing
// row, and an out-of-order correction — not that `CLASSIFICATION` and `decisions.md` agree today,
// which is what the conditional check below (limit 1) is for.

/**
 * The settled table. One row per (task, criterion); `dim` is the tagged dimension letter (as
 * `tests/evals/lib/score.mjs`'s `criterionTags()` reads it from the live task spec — tied to that
 * source directly by an always-on check in `eval-runner.sh`, not merely asserted here); `verdict`
 * is `'gating'` or `'report-only'`; `ref` points at the exact decisions.md#d11 passage that settled
 * that row, so a reader lands on the reasoning, not just the conclusion.
 *
 * Criterion numbers are task 02's CURRENT (post-merge, post-renumber) numbers — the ones the
 * shipped task spec (`tests/evals/tasks/02-code-guards-its-own-fix.md`) actually uses, confirmed
 * by reading it directly: 1=S5 (merged), 2=S3, 3=S1, 4=S6.
 */
export const CLASSIFICATION = Object.freeze([
  { task: '01', criterion: 1, dim: 'S2', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '01', criterion: 2, dim: 'S2', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '01', criterion: 3, dim: 'S7', verdict: 'report-only', ref: 'd11 Decision table (Option C, noInventedFigures rejected as ungating)' },
  { task: '01', criterion: 4, dim: 'S1', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '01', criterion: 5, dim: 'S6', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '01', criterion: 6, dim: 'S3', verdict: 'gating', ref: 'd11 Decision table (boundaryRespected, the worked example of soundness)' },
  { task: '02', criterion: 1, dim: 'S5', verdict: 'gating', ref: 'd11 2026-08-09 correction, point 1 (criteria 1+2 merged into one)' },
  { task: '02', criterion: 2, dim: 'S3', verdict: 'report-only', ref: 'd11 Decision table, renumbered 3->2 by the 2026-08-09 correction' },
  { task: '02', criterion: 3, dim: 'S1', verdict: 'report-only', ref: 'd11 2026-08-28 Resolution (S1 demoted, option 1 of the DECISIONS-NEEDED menu)' },
  { task: '02', criterion: 4, dim: 'S6', verdict: 'report-only', ref: 'd11 Decision table, renumbered 5->4 by the 2026-08-09 correction' },
  { task: '03', criterion: 1, dim: 'S4', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '03', criterion: 2, dim: 'S5', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '03', criterion: 3, dim: 'S1', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '03', criterion: 4, dim: 'S4', verdict: 'report-only', ref: 'd11 Decision table' },
  { task: '03', criterion: 5, dim: 'S7', verdict: 'report-only', ref: 'd11 Decision table' },
]);

/** rubric.md's aggregation rule, clause 1, no carve-out: a (task, dimension) pair gates only if
 * EVERY criterion tagged with it, within that task, is individually gating. `null` if the pair
 * doesn't appear in `table` at all. */
export function dimensionVerdict(task, dim, table = CLASSIFICATION) {
  const rows = table.filter((r) => r.task === task && r.dim === dim);
  if (rows.length === 0) return null;
  return rows.every((r) => r.verdict === 'gating') ? 'gating' : 'report-only';
}

/** Every distinct (task, dimension) pair `table` covers, aggregated per `dimensionVerdict` — what
 * decisions.md#d11 calls "N of 13 dimensions gate". */
export function taskDimensions(table = CLASSIFICATION) {
  const seen = new Map();
  for (const { task, dim } of table) {
    const key = `${task}:${dim}`;
    if (!seen.has(key)) seen.set(key, { task, dim, verdict: dimensionVerdict(task, dim, table) });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------
// Deriving the same table from decisions.md#d11's own markdown — the other side of the drift
// check. See the header comment above for what this can and cannot catch.
// ---------------------------------------------------------------------------------------------

// The one literal anchor this parser still needs: D11's own heading, confirmed to occur exactly
// once (`grep -c '## D11' decisions.md` -> 1). Everything else below is structural (heading level,
// table row shape), not another literal string that has to be kept in sync by hand.
const D11_HEADING = /^## D11\b/m;

// Task 02's criteria 1/2 merged into the new criterion 1 (its current truth comes from a LATER
// table, not this row); criteria 3/4/5 renumbered 2/3/4, "unchanged in content" for 3 and 5
// (decisions.md#d11, 2026-08-09 correction, point 1, quoted verbatim). Old criteria 1, 2 and 4 are
// deliberately absent here too: their current truth also comes from a later table, under a
// different number.
const TASK02_STABLE_RENUMBER = { 3: 2, 5: 4 };

// Every line shaped like a classification-table row, in either of D11's two known column layouts
// (7 columns in the original table, 5 in the settled one — splitting on `|` and trimming, rather
// than a fixed-width regex, is what makes one parser work for both, and for any future table using
// either shape).
const ROW_RE = /^\|\s*0[123]\s*\|\s*\d+\s*\|\s*S\d\s*\|/;

/**
 * Slice out D11's own span: from its heading to the next `## ` heading, or end of file. Structural
 * (heading level), not literal — but still ends at a `## ` line anywhere in D11's own prose
 * (disclosed, not fixed; silent past the settled table — see the header comment). Bounds every
 * top-level entry in this file, including the "## Superseded entries" section D11 currently sits
 * just before.
 */
function d11Section(text) {
  const start = text.search(D11_HEADING);
  if (start === -1) {
    throw new Error('classification.mjs: "## D11" heading not found in decisions.md -- has the entry been renamed, removed, or resectioned? re-verify by hand before trusting this check again');
  }
  const bodyFrom = text.indexOf('\n', start) + 1;
  const rest = text.slice(bodyFrom);
  const nextHeading = rest.search(/^## /m);
  return text.slice(start, nextHeading === -1 ? text.length : bodyFrom + nextHeading);
}

/**
 * Every classification-shaped table within `section`, as separate arrays, in document order. A
 * "table" is a maximal run of contiguous `ROW_RE`-matching lines — how every table in D11 has
 * actually been written (a table's rows are adjacent lines; nothing else in this entry's prose
 * matches the row shape).
 */
function extractTables(section) {
  const tables = [];
  let current = null;
  for (const line of section.split('\n')) {
    if (!ROW_RE.test(line)) { current = null; continue; }
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    const [task, critStr, dim] = cells;
    const verdictRaw = cells[cells.length - 1].replace(/\*/g, '');
    if (verdictRaw !== 'GATING' && verdictRaw !== 'report-only') throw new Error(`classification.mjs: row "${line.trim()}" has an unrecognized verdict cell "${verdictRaw}" -- a later correction spelled differently would be silently ignored; extend the accepted spellings in extractTables() or re-verify by hand before trusting this check again`);
    if (!current) { current = []; tables.push(current); }
    current.push({ task, criterion: Number(critStr), dim, verdict: verdictRaw === 'GATING' ? 'gating' : 'report-only' });
  }
  return tables;
}

/**
 * Derive the settled classification directly from decisions.md#d11's own markdown text.
 *
 * D11's five corrections to date have every one of them been APPENDED as a new dated section,
 * never an edit to prior text in place — so every classification-shaped table found in D11's span
 * is read, in document order, and for a (task, criterion) key asserted by more than one table, the
 * LAST one wins (a row asserted nowhere in the current text simply never enters the map, so it
 * surfaces as `extra:` from `diffClassification` rather than a silent pass). The FIRST table
 * found is the pre-2026-08-09 original — the only one that still uses task 02's OLD criterion
 * numbers, remapped via `TASK02_STABLE_RENUMBER` before it can collide with anything. Every table
 * after it already uses the settled numbering (the renumbering happened once, in the correction
 * that produced the second table), so later tables' rows are taken as-is.
 *
 * Throws rather than returning a partial or empty table when D11's heading can't be found, or when
 * fewer than 2 classification-shaped tables turn up in its span — an unparseable decisions.md is
 * itself a drift signal, not a quiet pass.
 */
export function decisionsMdClassification(text) {
  const tables = extractTables(d11Section(text));
  if (tables.length < 2) {
    throw new Error(`classification.mjs: expected at least 2 classification-shaped tables in decisions.md#d11 (the original 16-row table and the settled resolution table), found ${tables.length} -- the entry may have been restructured; re-verify by hand before trusting this check again`);
  }

  const [originalTable, ...laterTables] = tables;
  const key = (r) => `${r.task}:${r.criterion}`;
  const rows = new Map();

  for (const r of originalTable) {
    if (r.task !== '02') { rows.set(key(r), r); continue; }
    const renumbered = TASK02_STABLE_RENUMBER[r.criterion];
    if (renumbered == null) continue; // old criteria 1, 2, 4 -- superseded, read from a later table
    rows.set(key({ ...r, criterion: renumbered }), { ...r, criterion: renumbered });
  }
  for (const table of laterTables) {
    for (const r of table) rows.set(key(r), r); // later table wins on a shared key -- last statement stands
  }
  return [...rows.values()];
}

/**
 * Set-diff two classification tables by (task, criterion). `null` when every row matches exactly;
 * otherwise a short, printable description of the FIRST disagreement found — a wrong verdict takes
 * priority over a missing row, and a missing row over an extra one, since a wrong verdict silently
 * shipped is the dangerous case this check exists to catch.
 */
export function diffClassification(actual, expected) {
  const key = (r) => `${r.task}:${r.criterion}`;
  const byKey = (table) => new Map(table.map((r) => [key(r), r]));
  const a = byKey(actual);
  const e = byKey(expected);
  for (const [k, exp] of e) {
    const got = a.get(k);
    if (!got) return `missing:${k}`;
    if (got.dim !== exp.dim || got.verdict !== exp.verdict) {
      return `mismatch:${k}:got=${got.dim}/${got.verdict}:want=${exp.dim}/${exp.verdict}`;
    }
  }
  for (const k of a.keys()) if (!e.has(k)) return `extra:${k}`;
  return null;
}
