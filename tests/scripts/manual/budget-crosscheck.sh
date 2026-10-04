#!/usr/bin/env bash
# OPT-IN cross-check: compares the frozen PREREGISTERED table in tests/evals/lib/budget.mjs with the
# figures written in the requirements documents under .somi/rd/reliable-eval-gate/. Run it by hand
# whenever a figure is re-registered:
#   bash tests/scripts/manual/budget-crosscheck.sh
#
# It is deliberately NOT part of `npm test`: it lives outside the tests/scripts/eval-gate-*.sh glob that
# scripts/validate.sh runs, nothing references it, and the folder it reads is gitignored, so a fresh
# clone does not have it. It is excluded from the npm tarball by tests/.npmignore.
#
# Exit 0: every figure found in the prose and equal to the table. Exit 1: a mismatch (the message names
# the figure and the file). Exit 2: a source document or the table could not be read.
# RD_DIR overrides the documents' folder (used to prove this script fails on a mismatch).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
RD_DIR="${RD_DIR:-.somi/rd/reliable-eval-gate}"
for f in "$RD_DIR/decisions.md" "$RD_DIR/srs.md"; do
  [ -r "$f" ] || { echo "budget-crosscheck: cannot read $f (the requirements folder is gitignored; is this a fresh clone?)" >&2; exit 2; }
done
[ -r tests/evals/lib/budget.mjs ] || { echo "budget-crosscheck: tests/evals/lib/budget.mjs not found" >&2; exit 2; }

RD_DIR="$RD_DIR" node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { PREREGISTERED as T } from './tests/evals/lib/budget.mjs';
const dir = process.env.RD_DIR;
// Whitespace collapsed so a figure wrapped across lines still matches.
const read = (f) => readFileSync(dir + '/' + f, 'utf8').replace(/\s+/g, ' ');
const decisions = read('decisions.md');
const srs = read('srs.md');
// Each entry: [figure name(s), file label, text, prose with the table's value interpolated].
const checks = [
  ['perDrawUsd', 'decisions.md', decisions, \`Credits per draw: **\\\$\${T.perDrawUsd}**\`],
  ['perDrawMin', 'decisions.md', decisions, \`→ **\${T.perDrawMin} min end to end**\`],
  ['perRunUsd', 'decisions.md', decisions, \`Credits per gate run: ~~\\\$80~~ → **\\\$\${T.perRunUsd}**\`],
  ['perRunHours', 'decisions.md', decisions, \`→ **\${T.perRunHours} h worst case incl. triage**\`],
  ['runDraws, runConcurrent', 'decisions.md', decisions, \`\${T.runDraws} draws at \${T.runConcurrent}-way concurrency in \${T.runDraws / T.runConcurrent} waves\`],
  ['phase1Usd', 'decisions.md', decisions, \`**actual-spend cap of \\\$\${T.phase1Usd}**\`],
  ['inFlightCeilingUsd - perRunUsd (in-flight overshoot)', 'decisions.md', decisions, \`overshoot by up to \\\$\${T.inFlightCeilingUsd - T.perRunUsd}\`],
  ['perDrawUsd, perRunUsd, inFlightCeilingUsd, phase1Usd, replacementSmokeUsd', 'srs.md (NFR-3)', srs,
    \`≤ \\\$\${T.perDrawUsd} per draw (over = fail); ≤ \\\$\${T.perRunUsd} per gate run (hard ceiling \\\$\${T.inFlightCeilingUsd} with in-flight overshoot); ≤ \\\$\${T.phase1Usd} actual one-time Phase 1; ≤ \\\$\${T.replacementSmokeUsd} per replacement smoke\`],
  ['perDrawMin, perRunHours, runDraws, runConcurrent', 'srs.md (NFR-12)', srs,
    \`≤ \${T.perDrawMin} minutes per draw end to end (over = fail); ≤ \${T.perRunHours} hours per gate run worst case (\${T.runDraws} draws, \${T.runConcurrent} concurrent, \${T.runDraws / T.runConcurrent} waves)\`],
];
let bad = 0;
for (const [figure, file, text, prose] of checks) {
  if (text.includes(prose)) { console.log('ok   ' + figure + ' in ' + file); continue; }
  bad++;
  console.error('MISMATCH ' + figure + ': ' + file + ' does not contain \"' + prose + '\"');
}
if (bad > 0) { console.error('budget-crosscheck: ' + bad + ' mismatch(es); re-register the figure in budget.mjs, budget.json and the requirements together'); process.exit(1); }
console.log('budget-crosscheck: table matches the requirements documents');
"
