// The usage and speed benchmark's verdict function: candidate baseline versus baseline under the registered rule.
// Pure; returns a result object or { refused, code } (code "invalid-input" for a bad baseline or rule, else
// "refusal"), never a throw. verdict(candidate, baseline, ruleInfo, { primaryMetric, draft }) where ruleInfo is
// what bench-rule's parseRule returns and primaryMetric names exactly one metric of the rule's table
// (bytes, ms, time, cost, tokens, turns). Every ratio is candidate over baseline and lower is better.
//
// Per metric: ratio estimate and interval, then status. "better" needs the WHOLE interval strictly below
// 1 - m, "worse" strictly above 1 + m (m is the layer's minimum effect), anything else is "inconclusive".
//   L0  bytes: per scenario ratio of exact bytes, pooled by geometric mean; the interval is the point itself.
//   L1  ms: per event ratio of medians, bootstrapped, events pooled by geometric mean.
//   L2  time, cost, tokens, turns: per scenario, pooled by geometric mean. The primary basis comes from the
//       rule's table: "absolute" is candidate SoMi median / baseline SoMi median; "overhead" is
//       (candidate SoMi / candidate bare) / (baseline SoMi / baseline bare). tokens is the sum of all four token
//       classes over all models.
// Resampling: every arm of every scenario is resampled independently from one mulberry32 stream seeded by the
// rule; per resample, per scenario, arms in the order [candidate somi, (candidate bare,) baseline somi,
// (baseline bare)]. With two arms this is bench-stats' scenarioStratified exactly.
// Headline verdict (primary metric only): its status, then
//   drift    a would-be better/worse whose secondary basis (L2 only) has its whole interval strictly on the
//            opposite side of 1 becomes "inconclusive-drift";
//   guarded  a would-be better (not already drifted) becomes "inconclusive-guarded" when the quality guard trips.
// Other metrics are reported with their own status and never produce the headline.
// Guard (L2 primary only; SoMi arm; per scenario over in-stratum, non-paused draws): trips when the baseline
// median hidden-suite fraction exceeds the candidate's by more than medianDrop, or the candidate's share of
// invalid-or-zero draws exceeds the baseline's by more than invalidShareIncrease. An over-budget draw counts
// as fraction 0 and as a zero draw; an invalid draw has no fraction and counts as invalid; a paused draw is in
// neither, only in the reported paused count. It can only turn better into guarded.
// Draws: only "scored", unpaused draws in the scenario's required tier (when it has one) enter ratio samples;
// paused, over-budget, invalid and off-tier draws are counted per side and arm under `draws`.
// Host: the fingerprint minus pluginVersion must match for ms and time; otherwise those metrics are
// "not-comparable" (a refusal when primary). L1 needs at least the rule's minRepeats samples per event.

import { median, geometricMean } from './bench-stats.mjs';
import { mulberry32 } from './mann-whitney.mjs';
import { baselineProblems, TOKEN_CLASSES } from './bench-schema.mjs';

const WALL = ['ms', 'time'];
const refusal = (reason, code = 'refusal') => ({ refused: reason, code });
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const exceeds = (diff, margin) => diff - margin > 1e-9;
const status = (lo, hi, m) => (hi < 1 - m ? 'better' : lo > 1 + m ? 'worse' : 'inconclusive');

function bootstrap(strata, ratioOf, o) {
  const point = [];
  for (const arms of strata) {
    if (!arms.every((a) => a.length > 0 && a.every((x) => Number.isFinite(x) && x > 0))) return null;
    point.push(ratioOf(arms.map(median)));
  }
  const rng = mulberry32(o.seed);
  const stats = new Array(o.resamples);
  for (let r = 0; r < o.resamples; r++) {
    const ratios = strata.map((arms) => ratioOf(arms.map((xs) => {
      const d = xs.map(() => xs[Math.floor(rng() * xs.length)]);
      return median(d);
    })));
    stats[r] = geometricMean(ratios);
  }
  stats.sort((p, q) => p - q);
  const k = Math.floor((stats.length * (1 - o.level)) / 2 + 1e-9);
  return { estimate: geometricMean(point), lower: stats[k], upper: stats[stats.length - 1 - k] };
}

const value = (row, metric) => (metric === 'time' ? row.durationMs : metric === 'cost' ? row.costUsd : metric === 'turns' ? row.turns
  : Object.values(row.tokens).reduce((t, m) => t + TOKEN_CLASSES.reduce((s, c) => s + m[c], 0), 0));
const inStratum = (row, sc) => sc.requiredTier === null || row.tier === sc.requiredTier;
const usable = (row, sc) => row.outcome === 'scored' && !row.paused && inStratum(row, sc);

function drawCounts(b) {
  const out = { somi: {}, bare: {} };
  for (const arm of ['somi', 'bare']) {
    const rows = b.L2.rows.filter((r) => r.arm === arm);
    const sc = (r) => b.scenarios.find((s) => s.id === r.scenario);
    out[arm] = {
      usable: rows.filter((r) => usable(r, sc(r))).length, paused: rows.filter((r) => r.paused).length,
      overBudget: rows.filter((r) => r.outcome === 'over-budget').length, invalid: rows.filter((r) => r.outcome === 'invalid').length,
      offStratum: rows.filter((r) => r.outcome === 'scored' && !inStratum(r, sc(r))).length,
    };
  }
  return out;
}

function guard(cand, base, rule) {
  const q = rule.qualityGuard;
  const per = cand.scenarios.map((sc) => {
    const pick = (b) => b.L2.rows.filter((r) => r.arm === 'somi' && r.scenario === sc.id && !r.paused && inStratum(r, sc));
    const frac = (rs) => rs.filter((r) => r.outcome !== 'invalid').map((r) => (r.outcome === 'over-budget' ? 0 : r.green / r.total));
    const zero = (rs) => rs.filter((r) => r.outcome === 'invalid' || r.outcome === 'over-budget' || r.green === 0).length / rs.length;
    const [c, b] = [pick(cand), pick(base)];
    if (c.length === 0 || b.length === 0 || frac(c).length === 0 || frac(b).length === 0) return { scenario: sc.id, evaluated: false, tripped: false };
    const drop = median(frac(b)) - median(frac(c));
    const rise = zero(c) - zero(b);
    return { scenario: sc.id, evaluated: true, medianDrop: drop, invalidShareRise: rise, tripped: exceeds(drop, q.medianDrop) || exceeds(rise, q.invalidShareIncrease) };
  });
  return { tripped: per.some((p) => p.tripped), scenarios: per };
}

export function verdict(candidate, baseline, ruleInfo, opts = {}) {
  if (!ruleInfo || !ruleInfo.rule || typeof ruleInfo.hash !== 'string') return refusal('rule is not a parsed rule', 'invalid-input');
  if (opts === null || typeof opts !== 'object') return refusal('options must be an object', 'invalid-input');
  const { rule, hash } = ruleInfo;
  const table = rule.metrics.flatMap((row) => row.metrics.map((metric) => ({ metric, row })));
  const pm = opts.primaryMetric;
  if (typeof pm !== 'string' || !table.some((t) => t.metric === pm)) return refusal(`a single primary metric is required, one of ${table.map((t) => t.metric).join(', ')}`);
  for (const [name, b] of [['candidate', candidate], ['baseline', baseline]]) {
    const p = baselineProblems(b, opts);
    if (p.length) return refusal(`invalid ${name}: ${p.slice(0, 3).join('; ')}`, 'invalid-input');
  }
  const [c, b] = [candidate, baseline];
  if (c.rule.hash !== b.rule.hash) return refusal('rule hash differs between the baselines');
  if (c.rule.hash !== hash || c.rule.version !== rule.version) return refusal('the baselines were recorded under a different rule than the one loaded');
  if (!ruleInfo.sealed && opts.draft !== true) return refusal('the rule is not sealed; pass the draft flag for a DRAFT result');
  if (c.model.alias !== b.model.alias) return refusal('model alias differs; re-record the baseline');
  if (c.model.tier !== b.model.tier) return refusal('model tier differs; re-record the baseline');
  if (c.pinAll !== b.pinAll) return refusal('pin-all differs between the baselines');
  const list = (x) => canon([...x.scenarios].sort((p, q) => (p.id < q.id ? -1 : 1)));
  if (list(c) !== list(b) || canon(Object.keys(c.L0.bytes).sort()) !== canon(Object.keys(b.L0.bytes).sort()) ||
    canon(Object.keys(c.L1.events).sort()) !== canon(Object.keys(b.L1.events).sort())) return refusal('scenario lists differ (scenarios, L0 entries or L1 events)');
  for (const x of [c, b]) if (x.L2.rows.some((r) => r.phase !== 'experiment')) return refusal('rows from a phase other than experiment (phases must not be mixed)');
  const o = rule.bootstrap;
  const sameHost = (() => { const f = (h) => canon({ ...h, pluginVersion: 0 }); return f(c.host) === f(b.host); })();
  const layerOf = (t) => t.row.layer.slice(0, 2);
  const metricRow = (t, role, basis) => {
    const layer = layerOf(t);
    const base = { metric: t.metric, layer, role, basis };
    const m = layer === 'L0' ? rule.minEffect.L0 : layer === 'L1' ? rule.minEffect.L1.effect : rule.minEffect.L2[t.metric];
    const na = (note) => ({ ...base, minEffect: m, status: 'not-comparable', note });
    let r;
    if (WALL.includes(t.metric) && !sameHost) return na('host fingerprint differs');
    if (layer === 'L0') {
      const ids = Object.keys(c.L0.bytes);
      if (!ids.length) return na('no data');
      const g = geometricMean(ids.map((k) => c.L0.bytes[k] / b.L0.bytes[k]));
      r = { estimate: g, lower: g, upper: g };
    } else if (layer === 'L1') {
      const names = Object.keys(c.L1.events);
      if (!names.length) return na('no data');
      if (names.some((k) => c.L1.events[k].length < rule.minEffect.L1.minRepeats || b.L1.events[k].length < rule.minEffect.L1.minRepeats)) return na('repeats below the rule minimum');
      r = bootstrap(names.map((k) => [c.L1.events[k], b.L1.events[k]]), (x) => x[0] / x[1], o);
    } else {
      const S = (x, id, arm) => x.L2.rows.filter((q) => q.scenario === id && q.arm === arm && usable(q, x.scenarios.find((s) => s.id === id))).map((q) => value(q, t.metric));
      const arms = (id) => (basis === 'absolute' ? [S(c, id, 'somi'), S(b, id, 'somi')] : [S(c, id, 'somi'), S(c, id, 'bare'), S(b, id, 'somi'), S(b, id, 'bare')]);
      const strata = c.scenarios.map((s) => arms(s.id));
      if (strata.some((a) => a.some((xs) => xs.length === 0))) return na('a scenario has no usable draws in an arm');
      r = bootstrap(strata, basis === 'absolute' ? (x) => x[0] / x[1] : (x) => (x[0] / x[1]) / (x[2] / x[3]), o);
    }
    if (r === null) return na('non-positive samples');
    return { ...base, minEffect: m, ...r, status: status(r.lower, r.upper, m) };
  };
  const rows = table.map((t) => metricRow(t, t.metric === pm ? 'primary' : 'reported', t.row.primaryBasis));
  const primary = rows.find((r) => r.role === 'primary');
  if (primary.status === 'not-comparable') return refusal(`primary metric ${pm}: ${primary.note}`);
  const t = table.find((x) => x.metric === pm);
  const l2 = primary.layer === 'L2';
  let secondary = null;
  if (t.row.secondaryBasis !== null) {
    secondary = metricRow(t, 'secondary', t.row.secondaryBasis);
    if (secondary.status !== 'not-comparable') secondary = { ...secondary, minEffect: 0, status: status(secondary.lower, secondary.upper, 0) };
  }
  const q = l2 ? guard(c, b, rule) : null;
  let out = primary.status;
  if (out !== 'inconclusive' && secondary && secondary.status !== 'not-comparable') {
    const opposite = out === 'better' ? 'worse' : 'better';
    if (secondary.status === opposite) out = 'inconclusive-drift';
  }
  if (out === 'better' && q && q.tripped) out = 'inconclusive-guarded';
  return {
    verdict: out, draft: !ruleInfo.sealed, primaryMetric: pm, ruleHash: hash, ruleVersion: rule.version, tier: c.model.tier,
    alias: c.model.alias, candidateSha: c.sha, baselineSha: b.sha, metrics: rows, secondary, guard: q,
    draws: l2 ? { candidate: drawCounts(c), baseline: drawCounts(b) } : null,
  };
}
