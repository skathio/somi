// stats.mjs: the pre-registered analysis, as pure functions over recorded rows. One row is one draw:
//   { task, arm, draw, solved: boolean, weighted: number, cost: number, wall_ms: number, turns: number, abandoned?: boolean }
// Tasks are the cluster: each task's arm difference is one observation, so the standard error over tasks is the clustered paired one.

export const K_DRAWS = 3;

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

const solvedValue = (r) => (r.solved ? 1 : 0);
// The finer quality measure. A draw that did not finish scores zero, because a stopped loop has not delivered what its tests show.
export const testShare = (r) => ((r.label ?? (r.outcome === 'scored' ? 'finished' : 'other')) === 'finished' && r.total > 0 ? r.green / r.total : 0);

// Mean over tasks of (armA rate minus armB rate). Only tasks with k draws in both arms pair; the rest are reported as `unpaired`.
export function pairedDifference(rows, armA, armB, k = K_DRAWS, value = solvedValue) {
  const rate = (list) => list.reduce((s, r) => s + value(r), 0) / list.length;
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
    labels: list.reduce((counts, r) => { const key = r.gate ? `${r.label}:${r.gate}` : r.label ?? r.outcome; return { ...counts, [key]: (counts[key] ?? 0) + 1 }; }, {}),
  };
}

// The A/A run is the noise floor. A bare-versus-bare interval that excludes zero means the instrument itself is biased.
export function evaluateAa(rows, k = K_DRAWS) {
  const diff = pairedDifference(rows, 'bare-a', 'bare-b', k);
  return { ...diff, contains_zero: diff.lower !== null && diff.lower <= 0 && diff.upper >= 0 };
}

// The release rule, evaluated mechanically. `ships` is true only when every condition holds, and `reasons` names each one that did not.
export function evaluateRelease({ aa, main, candidate = 'somi5', baseline = 'bare', rule }) {
  const { min_tasks: minTasks, solved_rate_margin: solvedMargin, test_share_margin: shareMargin, max_cost_ratio: maxRatio, k, aa_k: aaK } = rule;
  const reasons = [];
  const floor = evaluateAa(aa, aaK);
  const solved = pairedDifference(main, candidate, baseline, k);
  const share = pairedDifference(main, candidate, baseline, k, testShare);
  const cand = armSummary(main, candidate, k);
  const base = armSummary(main, baseline, k);
  const ratio = cand.cost_per_solved !== null && base.cost_per_solved ? cand.cost_per_solved / base.cost_per_solved : null;
  const tokenRatio = cand.weighted_per_solved !== null && base.weighted_per_solved ? cand.weighted_per_solved / base.weighted_per_solved : null;
  if (!floor.contains_zero) reasons.push('the A/A interval is missing or excludes zero, so the instrument is not trusted');
  if (cand.abandoned || base.abandoned) reasons.push('an arm was abandoned: no valid score');
  if (solved.n < minTasks) reasons.push(`only ${solved.n} tasks paired; the registration needs ${minTasks}`);
  if (solved.unpaired.length > 0) reasons.push(`${solved.unpaired.length} tasks have incomplete draws`);
  if (solved.lower === null || solved.lower < solvedMargin) reasons.push('the lower bound of the solved-rate difference is below its margin');
  if (share.lower === null || share.lower < shareMargin) reasons.push('the lower bound of the hidden-test share difference is below its margin');
  if (ratio === null || ratio > maxRatio) reasons.push('dollars per solved task are over the allowed ratio to bare');
  return { ships: reasons.length === 0, reasons, aa: floor, cost_ratio: ratio, token_ratio: tokenRatio, solved, test_share: share, arms: { [candidate]: cand, [baseline]: base } };
}

// The set is mixed on purpose. Tasks in the band show change either way, tasks a bare agent always misses leave room for a review to help,
// and tasks it always solves show harm with little noise. A floor task must be a near miss: passing under half its tests says the task
// is broken or out of reach, not that one trap decided it.
const FLOOR_MIN_SHARE = 0.5;
export function selectTasks(pilotRows, candidates, { mix = { band: 4, floor: 4, ceiling: 8 }, minBoundary = 4, k = K_DRAWS } = {}) {
  const tasks = byTask(pilotRows);
  const classOf = (c) => {
    const list = tasks.get(c.id);
    if (!list || list.length !== k) return null;
    const solved = list.filter((r) => r.solved).length;
    if (solved === k) return 'ceiling';
    if (solved > 0) return 'band';
    return list.reduce((s, r) => s + testShare(r), 0) / k >= FLOOR_MIN_SHARE ? 'floor' : null;
  };
  // Within a class the kinds take turns and trust-boundary tasks go first, so no one kind fills the set.
  const take = (name, n) => {
    const pool = candidates.filter((c) => classOf(c) === name).sort((a, b) => Number(Boolean(b.boundary)) - Number(Boolean(a.boundary)) || a.id.localeCompare(b.id));
    const picked = [];
    const kinds = [...new Set(pool.map((c) => c.stratum))];
    for (let round = 0; picked.length < Math.min(n, pool.length); round++) {
      for (const kind of kinds) {
        const next = pool.filter((c) => c.stratum === kind)[round];
        if (next && picked.length < n) picked.push(next);
      }
    }
    return picked;
  };
  const kept = Object.entries(mix).flatMap(([name, n]) => take(name, n));
  const boundary = kept.filter((c) => c.boundary).length;
  const shortfalls = [];
  const strata = [...new Set(kept.map((c) => c.stratum).filter(Boolean))].sort();
  for (const [name, n] of Object.entries(mix)) {
    const got = kept.filter((c) => classOf(c) === name).length;
    if (got < n) shortfalls.push(`${got} ${name} tasks, ${n} wanted`);
  }
  if (boundary < minBoundary) shortfalls.push(`${boundary} trust-boundary tasks, ${minBoundary} wanted`);
  // The hardest are the ones a bare agent solved least, then the ones where it passed the smallest share of tests.
  const hardness = (c) => { const list = tasks.get(c.id); return [list.filter((r) => r.solved).length, list.reduce((s, r) => s + testShare(r), 0)]; };
  const hardest = [...kept].sort((a, b) => { const [x, y] = [hardness(a), hardness(b)]; return x[0] - y[0] || x[1] - y[1]; }).slice(0, 6).map((c) => c.id);
  return { tasks: kept, boundary, strata, shortfalls, hardest };
}

// Two-sided critical values at 90%, for cost, time and token ratios: a 90% interval is what the earlier recordings used.
const T90 = [6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.74, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697];
export const tCritical90 = (df) => (df < 1 ? Infinity : df <= 30 ? T90[df - 1] : 1.645);

const listOf = (arms) => (Array.isArray(arms) ? arms : [arms]);

// The ratio of metric between two arm sets, on the log scale: each task's mean log difference is one observation, so the task is the
// block and the cluster. This is the same estimate as a linear model with fixed task effects, and it needs no fitting library. Passing
// several arms on each side gives a factorial main effect. Draws with no positive metric are left out and counted.
export function logRatio(rows, armsA, armsB, metric = 'weighted') {
  const tasks = new Map();
  let dropped = 0;
  const add = (arms, side) => {
    for (const r of rows.filter((x) => listOf(arms).includes(x.arm))) {
      if (!(r[metric] > 0)) { dropped++; continue; }
      if (!tasks.has(r.task)) tasks.set(r.task, { a: [], b: [] });
      tasks.get(r.task)[side].push(Math.log(r[metric]));
    }
  };
  add(armsA, 'a');
  add(armsB, 'b');
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const diffs = [...tasks.values()].filter((t) => t.a.length && t.b.length).map((t) => mean(t.a) - mean(t.b));
  const n = diffs.length;
  if (n < 2) return { n, ratio: null, lower: null, upper: null, se: null, dropped };
  const m = mean(diffs);
  const se = Math.sqrt(diffs.reduce((s, d) => s + (d - m) ** 2, 0) / (n - 1) / n);
  const half = tCritical90(n - 1) * se;
  return { n, ratio: Math.exp(m), lower: Math.exp(m - half), upper: Math.exp(m + half), se, dropped };
}

// Holm's step-down, for the main effects of one recording. Takes [{ name, p }] and marks which survive at alpha.
export function holm(tests, alpha = 0.05) {
  const sorted = [...tests].sort((a, b) => a.p - b.p);
  let open = true;
  return sorted.map((t, i) => {
    open = open && t.p <= alpha / (sorted.length - i);
    return { ...t, significant: open };
  });
}

// A ratio is called only when its whole interval clears the minimum effect. Anything else is inconclusive and is published as that.
export function callRatio(r, minEffect) {
  if (r.ratio === null) return 'no estimate';
  if (r.upper <= 1 - minEffect) return 'lower';
  if (r.lower >= 1 / (1 - minEffect)) return 'higher';
  return 'inconclusive';
}

// One registered interim look. Crossing the boundary stops the recording early. Everything else runs to the planned number of draws.
export const crossesInterim = (estimate, se, z) => se > 0 && Math.abs(estimate) / se >= z;

// erf-based standard normal CDF (Abramowitz and Stegun 7.1.26).
export function normalCdf(x) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const Z_TWO_SIDED = { 0.9: 1.645, 0.95: 1.96 };
const Z_POWER = { 0.8: 0.842, 0.9: 1.282 };

// Draws per arm to resolve a cost change. Arms may differ in spread, and a workflow arm is much noisier than a bare one.
export function costDrawsPerArm({ sigmaA, sigmaB, effect, confidence = 0.9, power = 0.8 }) {
  const z = Z_TWO_SIDED[confidence] + Z_POWER[power];
  return Math.ceil((z * z * (sigmaA ** 2 + sigmaB ** 2)) / Math.log(1 - effect) ** 2) + 2;
}

// Draws per arm to detect a difference in pass rate. rho is the task-level correlation between arms. Calibrating tasks into a narrow
// band removes most between-task variance, so rho is close to zero on a calibrated set and pairing saves little.
export function passDrawsPerArm({ p1, p2, rho = 0, confidence = 0.95, power = 0.8 }) {
  const z = Z_TWO_SIDED[confidence] + Z_POWER[power];
  return Math.ceil((z * z * (p1 * (1 - p1) + p2 * (1 - p2)) * (1 - rho)) / (p1 - p2) ** 2);
}

// Chance that a lane with the given true difference clears a non-inferiority margin on the lower bound of a two-sided interval.
export function nonInferiorityPower({ margin, drawsPerArm, p = 0.5, trueDiff = 0, rho = 0, confidence = 0.95 }) {
  const se = Math.sqrt((2 * p * (1 - p) * (1 - rho)) / drawsPerArm);
  return normalCdf((trueDiff - margin) / se - Z_TWO_SIDED[confidence]);
}

// Draws per arm for a non-inferiority margin on a measure with the given per-draw standard deviation.
export function nonInferiorityDrawsPerArm({ margin, sd, trueDiff = 0, confidence = 0.95, power = 0.8 }) {
  const z = Z_TWO_SIDED[confidence] + Z_POWER[power];
  return Math.ceil((z * z * 2 * sd * sd) / (trueDiff - margin) ** 2);
}
