// scoring.mjs: a draw's result, and how arms rank on results before cost.

import { execFileSync } from 'node:child_process';
import { listFiles, snapshotTree } from '../../scripts/lib/git-tree.mjs';
import { qualityGate } from '../../scripts/lib/quality/gate.mjs';
import { limitsFor } from '../../scripts/lib/quality/limits.mjs';

// Results come first and cost second. A draw is a strict success when the hidden tests pass (P), the tests it wrote are valid (V:
// the cases among them that pass on the reference solution kill at least 60% of its mutants; a case that fails on the reference does
// not count either way), and the quality gate passes (G). Arms rank by strict
// successes, then by correct work with valid tests, and only then by cost, where costs within 10% are a tie. Until the gate ships, G
// is not scored and a strict success is P and V. Cheap work that fails the hidden tests, or tests that only prove themselves, cannot
// buy a place by costing less.
export const TEST_VALIDITY_KILL = 0.6;
export const COST_TIE = 0.1;
export function resultScore(row) {
  const P = row.solved === true ? 1 : 0;
  const o = row.own_tests;
  // A row recorded before cases were counted has only oracle_pass, which says whether every case agreed.
  const agree = o?.agree ?? (o?.oracle_pass === true ? 1 : 0);
  const V = !o ? null : o.tests > 0 && agree > 0 && (o.total === 0 || o.killed / o.total >= TEST_VALIDITY_KILL) ? 1 : 0;
  const G = typeof row.quality?.ok === 'boolean' ? (row.quality.ok ? 1 : 0) : null;
  return { P, V, G, strict: P * (V ?? 0) * (G ?? 1) };
}

export function rankArms(rows) {
  const arms = [...new Set(rows.map((r) => r.arm))].map((arm) => {
    const list = rows.filter((r) => r.arm === arm);
    const scores = list.map(resultScore);
    const sum = (f) => scores.reduce((s, x) => s + f(x), 0);
    return { arm, draws: list.length, P: sum((x) => x.P), V: sum((x) => x.V ?? 0), PV: sum((x) => x.P * (x.V ?? 0)), G: scores.some((x) => x.G !== null) ? sum((x) => x.G ?? 0) : null, strict: sum((x) => x.strict), cost: list.reduce((s, r) => s + (r.cost ?? 0), 0) / (list.length || 1) };
  });
  const costTie = (a, b) => Math.abs(a.cost - b.cost) <= COST_TIE * Math.max(a.cost, b.cost);
  arms.sort((a, b) => (b.strict - a.strict) || (b.PV - a.PV) || (costTie(a, b) ? 0 : a.cost - b.cost) || a.arm.localeCompare(b.arm));
  // The front: no other arm has at least as many strict successes for less.
  for (const a of arms) a.front = !arms.some((b) => b !== a && b.strict >= a.strict && b.cost < a.cost && (b.strict > a.strict || !costTie(a, b)));
  return arms;
}

// The quality gate on what a draw changed, from the workspace's first commit, so a draw that commits its own work is still measured.
// It scores the whole draw as a pull request, with the default limits in benchmark mode, where an agent's own exemptions count as
// violations. A gate that cannot run fails the draw's quality rather than leaving it unscored.
export async function scoreQuality(ws) {
  try {
    const roots = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
    const to = snapshotTree(ws);
    const r = await qualityGate(ws, { from: roots.at(-1), to, limits: limitsFor('pr'), mode: 'benchmark', repoFiles: listFiles(ws, to) });
    const rules = {};
    for (const v of r.violations) rules[v.rule] = (rules[v.rule] ?? 0) + 1;
    return { ok: r.ok, violations: r.violations.length, rules, scored: r.scored, unanalyzed: r.unanalyzed.length };
  } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
}

