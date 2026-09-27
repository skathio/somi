#!/usr/bin/env node
// Retires the two-valued MAX/ECO model-tier vocabulary. Until this gate existed,
// scripts/validate.sh only ever asserted frontmatter VALUES (the thirteen frontmatter model
// assertions this replaces), never prose -- so a half-converted ruleset (frontmatter switched to
// `cost:`, prose still saying "the ECO tier") passed silently. This is the check that closes
// that gap: it fails the build on the retired vocabulary anywhere in the swept roots, in either
// form -- the retired pattern is "MAX tier" / "ECO tier" / "MAX->ECO", and this matches
// word-boundary rather than those three spellings only, because "zero hits" has to mean zero,
// not "zero of the forms we thought to enumerate".
//
// EXEMPT, and named here because the exit criteria requires every exemption to be explicit and
// justified, not just silently excluded:
//   - scripts/lib/cost-model.mjs -- the mapping file itself; model names legitimately live here,
//     it is the one place a repricing or a new model gets edited.
//   - tests/scripts/cost-model.sh, tests/scripts/cost-ceiling.sh, tests/scripts/somi-dispatch.sh --
//     unit guards for the resolver above and its CLI; their assertions are literally "does
//     resolveModel(...) return the string 'haiku'" (or the CLI's JSON carry it), so the model
//     names are test data proving the mapping, not tier vocabulary.
//   - tests/evals/lib/boundary.mjs, tests/evals/lib/score.mjs -- historical comments about which
//     specific Claude model variant graded a past eval run (an unrelated grading concern, not
//     SoMi's own agent/command tier system).
//   - tests/scripts/eval-runner.sh -- asserts a removed CLI flag's example value and a
//     frontmatter validator's own recognized-model list; neither is the retired tier vocabulary,
//     and one case (`MAX-PASSES-EXCEEDED`) is a loop-status string whose true positive is the
//     word "PASSES", not "MAX" as a tier name.
//   - CHANGELOG.md -- historical release record; docs/VERSIONING.md's migration-notes
//     requirement for a MAJOR release means the retired words must stay quotable here.
//   - tests/evals/results/ (whole directory) -- recorded eval-run transcripts (candidate model
//     output from past runs); a transcript is data about what a model once said, not this
//     repo's own vocabulary in force.
//   - This file, and its own unit test (tests/scripts/retirement-gate.sh) -- the trap
//     validate.sh:296-300 already documents for the tools-doctrine sweep applies here too: a
//     detector's own pattern literals and the prose explaining them, and a test fixture built to
//     contain the retired words on purpose, must all name those words to do their job. A gate
//     that swept itself and its own test would fire on its own fix forever. Exempted by name,
//     not by weakening the pattern.
//
// A frontmatter `model: opus` / `model: sonnet` / `model: haiku` line is exempt for the same
// reason cost-model.mjs is: Claude Code reads that field directly to select a subagent's model
// (no command passes a model to Task, so this is the only mechanism today), so it is a
// structural necessity, not vocabulary describing a tier -- by design, `cost:` carries the
// retired MAX/ECO meaning and `model:` stays the host's selection mechanism. The exemption is
// POSITIONAL: it applies only inside a file's own frontmatter, or a fenced code block teaching
// that same frontmatter shape, never to a bare `model: opus` line anywhere else in a file's body.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXEMPT_FILES = new Set([
  'scripts/lib/cost-model.mjs',
  'tests/scripts/cost-model.sh',
  'tests/scripts/cost-ceiling.sh',
  'tests/scripts/somi-dispatch.sh',
  'tests/scripts/eval-runner.sh',
  'tests/evals/lib/boundary.mjs',
  'tests/evals/lib/score.mjs',
  'CHANGELOG.md',
  'tests/scripts/lib/retirement-gate.mjs',
  'tests/scripts/retirement-gate.sh',
]);

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.somi', 'coverage']);
const SKIP_PATH_PREFIXES = ['tests/evals/results/'];

const TIER_PATTERN = /\bMAX\b|\bECO\b/;
// Case-insensitive: prose naturally capitalizes at a sentence start ("Opus front-loads the
// reasoning"), and "zero hits" has to mean zero of every spelling, not just the lowercase ones.
// TIER_PATTERN stays case-sensitive on purpose -- `max`/`eco` lowercase are ordinary English
// words (`max-wait-attempts`, "the maximum," "eco-friendly"), and case-folding it would fire on
// all of them.
const MODEL_PATTERN = /\b(opus|sonnet|haiku)\b/i;
const FRONTMATTER_MODEL_LINE = /^model:\s*(opus|sonnet|haiku)\s*$/;

function walk(root, out) {
  let st;
  try {
    st = statSync(root);
  } catch {
    return; // a swept root that doesn't exist in this tree (e.g. a fixture missing tests/evals/)
  }
  if (st.isFile()) {
    out.push(root);
    return;
  }
  if (!st.isDirectory()) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const p = join(root, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('usage: retirement-gate.mjs <root...>');
  process.exit(2);
}

// Relative paths (for the EXEMPT_FILES lookup and the printed locations) are resolved against
// the current working directory -- the repo root when validate.sh runs this, or a scratch
// fixture directory when the test script below points it there.
const base = process.cwd();

const files = [];
for (const r of roots) walk(r, files);

const problems = [];
for (const file of files) {
  const rel = relative(base, file).split(sep).join('/');
  if (EXEMPT_FILES.has(rel)) continue;
  if (SKIP_PATH_PREFIXES.some((p) => rel.startsWith(p))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // not readable as a file (broken symlink, etc.) -- nothing to scan
  }
  // Binary-ish files (images, etc.) would false-positive on byte noise; skip anything with a
  // NUL byte, which no text file in this sweep legitimately contains.
  if (text.includes('\u0000')) continue;
  const lines = text.split('\n');
  // The bare `model:` exemption is POSITIONAL, not lexical: it applies only inside the file's own
  // YAML frontmatter (the first line is exactly `---`, through the next line that is exactly
  // `---`) or inside a fenced code block teaching that same frontmatter shape (docs/EXTENDING.md's
  // and docs/COMMANDS.md's "Adding an agent/command" recipes). A `model: opus` sitting at column 0
  // anywhere else -- a bullet, a table cell, an unrelated example -- is not exempt.
  let frontmatterEnd = -1;
  if (lines[0] === '---') {
    const closeIdx = lines.indexOf('---', 1);
    if (closeIdx !== -1) frontmatterEnd = closeIdx;
  }
  // CommonMark's own fencing rule, not a boolean toggle: a boolean flips on ANY run of backticks,
  // so an odd-length run inside a fence (e.g. a four-backtick-fenced block whose content itself
  // contains a three-backtick line) leaves it stuck open for the rest of the file. Track the
  // opening marker's length instead and close only on a marker at least as long.
  let fenceLen = 0;
  lines.forEach((line, i) => {
    const inFrontmatter = frontmatterEnd !== -1 && i <= frontmatterEnd;
    const fenceMatch = line.match(/^\s*(`{3,})/);
    if (fenceMatch) {
      if (!fenceLen) fenceLen = fenceMatch[1].length;
      else if (fenceMatch[1].length >= fenceLen) fenceLen = 0;
    }
    const inFence = fenceLen > 0;
    if ((inFrontmatter || inFence) && FRONTMATTER_MODEL_LINE.test(line)) return; // structural, not vocabulary
    if (TIER_PATTERN.test(line) || MODEL_PATTERN.test(line)) {
      problems.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

// Exits 0 for every SCAN outcome (clean or stale) and signals purely through stdout content
// (`ok*` vs. anything else) — the same idiom digest-marker-coupling.mjs uses just above this
// block's caller in validate.sh. A non-zero exit on a scan result would die silently: validate.sh's
// caller assigns this process's stdout via command substitution under `set -euo pipefail`, and a
// plain assignment's exit status is the substitution's, so `errexit` would kill the script at the
// assignment before the `case` that prints the hit list ever runs. One idiom, one place that
// decides pass/fail (the `case` in validate.sh), rather than two disagreeing signals (exit code
// and stdout shape). `process.exit(2)` below is reserved for a usage error (missing argv), whose
// message goes to stderr via console.error and therefore survives the caller's `set -e` — a
// different case from a scan result, not a second exception to this rule.
if (problems.length) {
  process.stdout.write(`STALE VOCABULARY (${problems.length} hit(s)):\n${problems.join('\n')}`);
} else {
  process.stdout.write(`ok (0 stale-vocabulary hits across ${files.length} file(s))`);
}
