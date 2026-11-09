#!/usr/bin/env node
// Calibrates the quality gate on known-good code. For one repository it measures every function's metrics at HEAD, by kind, and the
// LOC-weighted percentiles of each (Alves, Ypma and Visser 2010: weight each function by its lines, so a few huge ones count for what
// they hold). Then it runs the gate on the repository's recent commits, which were reviewed and merged, to see how often a known-good
// change fails and on which rule. Writes one JSON line per repository.
//   node benchmarks/quality/calibrate.mjs <repo> [--commits 30]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TEST_FILE } from '../../scripts/lib/signals.mjs';
import { fileAt, listFiles } from '../../scripts/lib/git-tree.mjs';
import { qualityGate } from '../../scripts/lib/quality/gate.mjs';
import { DEFAULT_LIMITS } from '../../scripts/lib/quality/limits.mjs';
import { unitsOf } from '../../scripts/lib/quality/metrics.mjs';
import { languageOf, parseSource } from '../../scripts/lib/quality/parse.mjs';

const SKIPPED = /(^|\/)(node_modules|vendor|dist|build|coverage|\.next|fixtures?|__fixtures__|testdata|test-data)\/|\.min\.js$|\.d\.ts$/;
const METRICS = ['cognitive', 'depth', 'lines', 'params'];
const PCTS = [70, 80, 90, 95, 99];

// The share of functions at or under each value, which is what a per-function limit acts on.
export function percentiles(units, metric, pcts = PCTS) {
  const values = units.map((u) => u[metric]).sort((a, b) => a - b);
  return Object.fromEntries(pcts.map((p) => [`p${p}`, values[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)] ?? null]));
}

export function weightedPercentiles(units, metric, pcts = PCTS) {
  const rows = units.map((u) => [u[metric], Math.max(1, u.lines)]).sort((a, b) => a[0] - b[0]);
  const total = rows.reduce((s, [, w]) => s + w, 0);
  const out = {};
  for (const p of pcts) {
    let acc = 0;
    const target = (p / 100) * total;
    out[`p${p}`] = rows.find(([, w]) => (acc += w) >= target)?.[0] ?? null;
  }
  return out;
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { commits: { type: 'string' } } });
const root = path.resolve(positionals[0]);
const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const head = git('rev-parse', 'HEAD');
const files = listFiles(root, head).filter((f) => ['javascript', 'typescript', 'tsx'].includes(languageOf(f)) && !SKIPPED.test(f));
const byKind = { function: [], component: [], test: [] };
let unanalyzed = 0;
for (const file of files) {
  const text = fileAt(root, head, file);
  if (text === null || /@generated\b|Code generated .* DO NOT EDIT/.test(text.slice(0, 500))) continue;
  const parsed = await parseSource(file, text);
  if (!parsed?.tree) { unanalyzed += 1; continue; }
  for (const u of unitsOf(parsed.tree, { file, isTest: TEST_FILE.test(file) })) byKind[u.kind].push(u);
  parsed.tree.delete();
}
const distributions = {};
for (const [kind, units] of Object.entries(byKind)) {
  if (!units.length) continue;
  distributions[kind] = { functions: units.length, over_default: {}, per_function: {}, weighted: {} };
  for (const m of METRICS) {
    distributions[kind].weighted[m] = weightedPercentiles(units, m);
    distributions[kind].per_function[m] = percentiles(units, m);
    distributions[kind].over_default[m] = Number((units.filter((u) => u[m] > DEFAULT_LIMITS[kind][m]).length / units.length).toFixed(4));
  }
}

const commits = git('log', '--no-merges', '--format=%H %P', '-n', values.commits ?? '30').split('\n').map((l) => l.split(' ')).filter((x) => x.length === 2 && x[1]);
const cache = new Map();
const changes = [];
for (const [sha, parent] of commits) {
  try {
    const r = await qualityGate(root, { from: parent, to: sha, limits: DEFAULT_LIMITS, repoFiles: listFiles(root, sha), cache });
    const rules = {};
    for (const v of r.violations) rules[v.rule] = (rules[v.rule] ?? 0) + 1;
    changes.push({ sha: sha.slice(0, 12), ok: r.ok, functions: r.scored.functions, warnings: r.warnings.length, rules, examples: r.violations.slice(0, 3).map((v) => `${v.rule} ${v.file}:${v.line} ${v.name ?? ''} ${v.value}/${v.limit}`) });
  } catch (e) { changes.push({ sha: sha.slice(0, 12), error: String(e.message).slice(0, 120) }); }
}
const scored = changes.filter((c) => !c.error && c.functions > 0);
process.stdout.write(`${JSON.stringify({ repo: path.basename(root), head: head.slice(0, 12), files: files.length, unanalyzed, distributions, commits: { scored: scored.length, failed: scored.filter((c) => !c.ok).length, changes } })}\n`);
