// stats.mjs: the pre-registered analysis, as pure functions over recorded rows. One row is one draw:
//   { task, arm, draw, solved: boolean, weighted: number, cost: number, wall_ms: number, turns: number, abandoned?: boolean }
// Tasks are the cluster: each task's arm difference is one observation, so the standard error over tasks is the clustered paired one.

export const K_DRAWS = 3;
export const MIN_TASKS = 20;
export const NON_INFERIORITY_MARGIN = -0.05;
export const MAX_TOKEN_RATIO = 1.5;

// Input counts 1, cache writes 1.25, cache reads 0.1 and output 5, the shape of how tokens are priced and count against a usage window.
const WEIGHTS = { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 };

export function weightedTokens(tokens) {
  return Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + (Number.isFinite(tokens?.[k]) ? tokens[k] * w : 0), 0);
}

// Two-sided 95% critical values of Student's t for 1 to 30 degrees of freedom.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tCritical95 = (df) => (df < 1 ? Infinity : df <= 30 ? T95[df - 1] : 1.96);

const armRows = (rows, arm) => rows.filter((r) => r.arm === arm);

function byTask(rows) {
  const tasks = new Map();
  for (const r of rows) {
    if (!tasks.has(r.task)) tasks.set(r.task, []);
    tasks.get(r.task).push(r);
  }
  for (const list of tasks.values()) list.sort((a, b) => a.draw - b.draw);
  return tasks;
}

const rate = (list) => list.filter((r) => r.solved).length / list.length;

// Mean over tasks of (armA rate minus armB rate). Only tasks with k draws in both arms pair; the rest are reported as `unpaired`.
export function pairedDifference(rows, armA, armB, k = K_DRAWS) {
  const a = byTask(armRows(rows, armA));
  const b = byTask(armRows(rows, armB));
  const diffs = [];
  const unpaired = [];
  for (const task of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(task)?.length === k && b.get(task)?.length === k) diffs.push(rate(a.get(task)) - rate(b.get(task)));
    else unpaired.push(task);
  }
  const n = diffs.length;
  if (n < 2) return { n, mean: null, se: null, lower: null, upper: null, unpaired: unpaired.sort() };
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const half = tCritical95(n - 1) * se;
  return { n, mean, se, lower: mean - half, upper: mean + half, unpaired: unpaired.sort() };
}

export function armSummary(rows, arm, k = K_DRAWS) {
  const list = armRows(rows, arm);
  const tasks = byTask(list);
  const complete = [...tasks.values()].filter((t) => t.length === k);
  const solved = list.filter((r) => r.solved).length;
  const sum = (key) => list.reduce((s, r) => s + (Number.isFinite(r[key]) ? r[key] : 0), 0);
  return {
    arm,
    draws: list.length,
    solved,
    abandoned: list.some((r) => r.abandoned === true),
    pass_at_1: complete.length ? complete.filter((t) => t[0].solved).length / complete.length : null,
    pass_all_k: complete.length ? complete.filter((t) => t.every((r) => r.solved)).length / complete.length : null,
    weighted_per_solved: solved ? sum('weighted') / solved : null,
    cost_per_solved: solved ? sum('cost') / solved : null,
    wall_ms_per_solved: solved ? sum('wall_ms') / solved : null,
    turns_per_draw: list.length ? sum('turns') / list.length : null,
  };
}

// The A/A run is the noise floor. A bare-versus-bare interval that excludes zero means the instrument itself is biased.
export function evaluateAa(rows) {
  const diff = pairedDifference(rows, 'bare-a', 'bare-b');
  return { ...diff, contains_zero: diff.lower !== null && diff.lower <= 0 && diff.upper >= 0 };
}

// The release rule, evaluated mechanically. `ships` is true only when every condition holds, and `reasons` names each one that did not.
export function evaluateRelease({ aa, main, candidate = 'somi5', baseline = 'bare', minTasks = MIN_TASKS }) {
  const reasons = [];
  const floor = evaluateAa(aa);
  const primary = pairedDifference(main, candidate, baseline);
  const cand = armSummary(main, candidate);
  const base = armSummary(main, baseline);
  const ratio = cand.weighted_per_solved !== null && base.weighted_per_solved ? cand.weighted_per_solved / base.weighted_per_solved : null;
  if (!floor.contains_zero) reasons.push('the A/A interval is missing or excludes zero, so the instrument is not trusted');
  if (cand.abandoned || base.abandoned) reasons.push('an arm was abandoned: no valid score');
  if (primary.n < minTasks) reasons.push(`only ${primary.n} tasks paired; the registration needs ${minTasks}`);
  if (primary.unpaired.length > 0) reasons.push(`${primary.unpaired.length} tasks have incomplete draws`);
  if (primary.lower === null || primary.lower < NON_INFERIORITY_MARGIN) reasons.push('the lower bound of the success difference is below the non-inferiority margin');
  if (ratio === null || ratio > MAX_TOKEN_RATIO) reasons.push('weighted tokens per solved task are over the allowed ratio to bare');
  return { ships: reasons.length === 0, reasons, aa: floor, primary, token_ratio: ratio, arms: { [candidate]: cand, [baseline]: base } };
}

// Keep tasks between floor and ceiling: bare solves 1 or 2 of k, so an arm has room to do better or worse.
export function selectTasks(pilotRows, candidates, { want = MIN_TASKS, minBoundary = 4, k = K_DRAWS } = {}) {
  const tasks = byTask(pilotRows);
  const offCeiling = candidates.filter((c) => {
    const list = tasks.get(c.id);
    if (!list || list.length !== k) return false;
    const solved = list.filter((r) => r.solved).length;
    return solved >= 1 && solved < k;
  });
  const boundaryFirst = [...offCeiling].sort((a, b) => Number(Boolean(b.boundary)) - Number(Boolean(a.boundary)) || a.id.localeCompare(b.id));
  const kept = boundaryFirst.slice(0, want);
  const boundary = kept.filter((c) => c.boundary).length;
  const shortfalls = [];
  if (kept.length < want) shortfalls.push(`${kept.length} off-ceiling tasks, ${want} wanted`);
  if (boundary < minBoundary) shortfalls.push(`${boundary} trust-boundary tasks, ${minBoundary} wanted`);
  return { tasks: kept, boundary, shortfalls };
}
