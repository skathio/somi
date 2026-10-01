#!/usr/bin/env node
// scripts/check-size-budget.mjs -- fail the build when a tracked file outgrows its line budget.
//
// BUDGETS (lines; one table, BUDGETS below)
//   prompt files  agents/*.md, commands/*.md, skills/**/*.md   300  (loaded into a model's context
//                                                                   on every run, so size is cost)
//   .mjs          any tracked file except tests/evals/results/  500
//   .sh           any tracked file                              800
//   Docs are not gated.
//
// Only tracked files count (`git ls-files`), so untracked scratch never trips the gate.
//
// THE LEDGER: scripts/size-budget-overrides.json
// A file already over budget is recorded there, one entry each, shaped
// `{file, budget, current_size, source, at, reason}` (the same audit idiom as the loop's
// `cap_overrides`). The ledger is tracked so an exemption is reviewable in a diff.
//   - An un-ledgered file over budget FAILS.
//   - A ledgered file larger than its recorded `current_size` FAILS: the entry exempts the file
//     as it is, not as it may become. Shrinking is always fine. Growth means updating the entry
//     with a reason a reviewer can challenge.
//   - A ledgered file now within budget WARNS (does not fail): delete its entry.
//   - A malformed ledger fails loudly (exit 2) rather than being read leniently.
//
// GOVERNANCE
//   - Who may add an entry: anyone introducing or materially touching an over-budget file, with a
//     concrete `reason` and a `source` (the commit that introduced or last touched it, from
//     `git log -1 --format=%h -- <file>`). Never a blanket exemption without attribution.
//   - Entries are revisited at every /release-readiness pass.
//   - The goal is an empty ledger: shrink or split a file, then remove its entry.
//
// Usage: node scripts/check-size-budget.mjs [--root <dir>]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LEDGER = 'scripts/size-budget-overrides.json';
const NOT_GATED = ['tests/evals/results/'];

// First matching row wins. `test` receives the repo-relative posix path.
const BUDGETS = [
  { kind: 'prompt', limit: 300, test: (f) => /^(agents|commands)\/[^/]+\.md$/.test(f) || /^skills\/.+\.md$/.test(f) },
  { kind: 'mjs', limit: 500, test: (f) => f.endsWith('.mjs') },
  { kind: 'sh', limit: 800, test: (f) => f.endsWith('.sh') },
];

const ENTRY_FIELDS = { file: 'string', budget: 'number', current_size: 'number', source: 'string', at: 'string', reason: 'string' };

function fatal(msg) {
  console.error(`size-budget: ${msg}`);
  process.exit(2);
}

function budgetFor(file) {
  if (NOT_GATED.some((p) => file.startsWith(p))) return null;
  return BUDGETS.find((b) => b.test(file)) || null;
}

function lineCount(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function trackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch (e) {
    return fatal(`cannot enumerate tracked files under ${root}: ${e.message}`);
  }
}

export function loadLedger(root) {
  const abs = path.join(root, LEDGER);
  if (!fs.existsSync(abs)) return new Map();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return fatal(`${LEDGER} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(data)) return fatal(`${LEDGER} must be a JSON array of entries`);
  const byFile = new Map();
  data.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fatal(`${LEDGER}[${i}] is not an object`);
    for (const [field, type] of Object.entries(ENTRY_FIELDS)) {
      const v = entry[field];
      const ok = typeof v === type && (type !== 'string' || v.trim() !== '') && (type !== 'number' || (Number.isInteger(v) && v > 0));
      if (!ok) fatal(`${LEDGER}[${i}] needs a ${type === 'number' ? 'positive integer' : 'non-empty string'} "${field}"`);
    }
    if (byFile.has(entry.file)) fatal(`${LEDGER} lists ${entry.file} twice`);
    byFile.set(entry.file, entry);
  });
  return byFile;
}

export function checkBudgets(root) {
  const ledger = loadLedger(root);
  const failures = [];
  const warnings = [];
  const tracked = new Set(trackedFiles(root));

  for (const file of [...tracked].sort()) {
    const budget = budgetFor(file);
    if (!budget) continue;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const size = lineCount(abs);
    const entry = ledger.get(file);
    if (size <= budget.limit) {
      if (entry) warnings.push(`${file} is ${size} lines, within its ${budget.limit} budget: remove its ledger entry`);
    } else if (!entry) {
      failures.push(`${file}: ${size} lines exceeds the ${budget.limit}-line ${budget.kind} budget and is not in ${LEDGER}`);
    } else if (size > entry.current_size) {
      failures.push(`${file}: ${size} lines grew past its ledgered ${entry.current_size}; shrink it, or update the entry with a reason`);
    }
  }
  for (const file of ledger.keys()) {
    if (!tracked.has(file)) warnings.push(`${file} is in the ledger but is not a tracked file: remove its entry`);
  }
  return { failures, warnings, ledgered: ledger.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootIdx = process.argv.indexOf('--root');
  const root = rootIdx === -1 ? process.cwd() : path.resolve(process.argv[rootIdx + 1]);
  const { failures, warnings, ledgered } = checkBudgets(root);
  for (const w of warnings) console.warn(`  warn: ${w}`);
  if (failures.length > 0) {
    console.error('FILE-SIZE BUDGET EXCEEDED:');
    for (const f of failures) console.error(`  ${f}`);
    console.error(`${failures.length} file(s). Shrink the file; see the header of scripts/check-size-budget.mjs for the ledger rules.`);
    process.exit(1);
  }
  console.log(`  ok: every tracked file is within its size budget (${ledgered} ledgered)`);
}
