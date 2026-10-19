// Report for the SoMi-vs-bare experiment: result rows -> the table, the compareArms verdicts and the counts. Pure: no I/O.
// Pair run order is the EARLIER of the two arms' order indexes. Excluded and incomplete pairs are counted, never silent.

import { compareArms } from './compare.mjs';

export const SIDE_TASKS = ['H4-static-files'];
export const CONTROL_TASKS = ['T1-proration', 'H5-pricing-refactor', 'H6-recurrence-bug'];
const median = (xs) => { const s = xs.filter(Number.isFinite).sort((p, q) => p - q); return s.length === 0 ? null : (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const cell = (r) => {
  if (!r) return '-';
  const green = r.outcome === 'paused' ? ` (scorer green ${r.green}/${r.total})` : '';
  return `${r.green}/${r.total} ${r.outcome}${green}${r.reason ? ` [${r.reason.slice(0, 24)}]` : ''} $${(r.costUsd ?? 0).toFixed(2)}${r.costEstimated ? '~' : ''} ${Math.round((r.durationMs ?? 0) / 1000)}s`;
};
const armOf = (r) => ({ green: r.green, total: r.total, outcome: r.outcome, ...(r.costUsd === 0 || (r.costUsd >= 1e-6 && r.costUsd <= 1e6) ? { cost: r.costUsd } : {}) });
const CAVEAT = 'Caveats: the host is not contained unless the run used the sandbox (see the plan line); inside it a draw still reaches the network '
  + '(web tools are disabled, a shell is not). SoMi hooks apply to the SoMi arm only, and both workspaces carry a .somi/config.json. The pooled n '
  + 'is far too small for a verdict, so read the table and the mean difference, not the verdict word. The author-side probes put strong solvers at or '
  + 'near the ceiling on most tasks, so expect ties; the noise draws show how far one bare draw moves by chance. Costs and times are single draws; '
  + 'a cost marked ~ is an estimate (the call ended without a result, the whole per-draw cap is charged). A call that overshoots the cap but otherwise '
  + 'succeeds is classed over-budget. A paused SoMi draw scores 0 in the verdict; its scorer green is shown next to it.';

/**
 * The old-corpus report reads experiment rows only. Rows of another phase, or rows of mixed phases, are refused with the reason;
 * rows written before the field existed are legacy and allowed (named in the report). -> {ok: true, legacy} | {ok: false, message}.
 */
export function checkPhases(rows) {
  const phases = new Set(rows.map((r) => r.phase).filter((p) => p !== undefined));
  const legacy = rows.filter((r) => r.phase === undefined).length;
  if (phases.size > 1) return { ok: false, message: `the rows mix phases (${[...phases].sort().join(', ')}); a calibration or sizing draw is never an experiment draw, report each phase from its own results file` };
  if (phases.size === 1 && !phases.has('experiment')) return { ok: false, message: `the rows carry phase ${[...phases][0]}, not experiment; a calibration or sizing draw is never an experiment draw and this report would turn it into a verdict` };
  return { ok: true, legacy };
}

/** Result rows -> the report text (tables, the compareArms verdicts, counts, noise spread, caveats). Throws on rows of another phase. */
export function buildReport(rows) {
  const ph = checkPhases(rows);
  if (!ph.ok) throw new Error(ph.message);
  const L = [];
  if (ph.legacy > 0) L.push(`note: ${ph.legacy} legacy row(s) without a phase field are treated as experiment rows`);
  const real = rows.filter((r) => !r.noise && r.outcome !== 'budget-stop');
  const tasks = [...new Set(real.map((r) => r.task))].sort();
  const get = (t, arm) => real.find((r) => r.task === t && r.arm === arm);
  L.push('task | bare | somi | resumes | scope (bare/somi)');
  for (const t of tasks) { const b = get(t, 'bare'); const s = get(t, 'somi'); L.push(`${t}${SIDE_TASKS.includes(t) ? ' [side]' : ''} | ${cell(b)} | ${cell(s)} | ${s?.resumes ?? '-'} | ${b?.scope?.ok ?? '-'}/${s?.scope?.ok ?? '-'}`); }
  const skipped = rows.filter((r) => r.outcome === 'budget-stop').length;
  const pairsFor = (skip) => {
    const full = tasks.filter((t) => get(t, 'bare') && get(t, 'somi') && !skip.includes(t)).filter((t) => [get(t, 'bare'), get(t, 'somi')].every((r) => Number.isInteger(r.total) && r.total >= 1));
    const order = (t) => Math.min(get(t, 'bare').order, get(t, 'somi').order);
    return full.sort((p, q) => order(p) - order(q)).map((t) => ({ task: t, bare: armOf(get(t, 'bare')), somi: armOf(get(t, 'somi')) }));
  };
  const verdictLine = (label, skip) => {
    const pairs = pairsFor(skip); const c = pairs.length === 0 ? null : compareArms(pairs);
    const wanted = tasks.filter((t) => !skip.includes(t));
    L.push(`${label}: ${pairs.length} complete pair(s) of ${wanted.length} task(s); ${wanted.length - pairs.length} incomplete and left out`);
    if (!c) { L.push('  verdict: none (no pairs, or the input shape was refused)'); return; }
    L.push(`  verdict: ${c.verdict} (${c.reason}); wins ${c.wins} losses ${c.losses} ties ${c.ties}; excluded as invalid ${c.excluded}; p ${c.p}; mean score difference (SoMi - bare) ${c.meanDiff}`);
    L.push(`  median cost ratio ${c.medianCostRatio ?? 'n/a'}; paused SoMi ${c.pausedSomi} bare ${c.pausedBare}; over-budget SoMi ${c.overBudgetSomi} bare ${c.overBudgetBare}; bare at ceiling ${c.ceiling}`);
    const times = pairs.filter((p) => p.bare.outcome !== 'invalid' && p.somi.outcome !== 'invalid').map((p) => get(p.task, 'somi').durationMs / get(p.task, 'bare').durationMs);
    L.push(`  median time ratio ${median(times)?.toFixed(2) ?? 'n/a'}`);
  };
  L.push(''); verdictLine(`Pooled (all tasks except the side result ${SIDE_TASKS.join(', ')})`, SIDE_TASKS);
  verdictLine(`Pooled excluding controls ${CONTROL_TASKS.join(', ')}`, [...SIDE_TASKS, ...CONTROL_TASKS]);
  const count = (arm, o) => real.filter((r) => r.arm === arm && r.outcome === o).length;
  L.push(`Outcomes (all tasks): ${['bare', 'somi'].map((a) => `${a}: scored ${count(a, 'scored')} paused ${count(a, 'paused')} over-budget ${count(a, 'over-budget')} invalid ${count(a, 'invalid')}`).join('; ')}; not run (budget stop) ${skipped}`);
  for (const r of real.filter((x) => x.outcome === 'invalid')) L.push(`  invalid: ${r.draw} ${r.reason}`);
  if (rows.some((r) => r.reason === 'bg-wait-ceiling')) L.push('bg-wait-ceiling: the CLI ended the session before the background work finished; the run was halted, a re-run with the same settings would end the same way');
  const limited = rows.filter((r) => r.reason === 'account-limit');
  if (limited.length > 0) L.push(`account-limit: re-run after ${[...new Set(limited.map((r) => r.resetText).filter(Boolean))].join(' / ') || 'the usage window resets (time unknown)'}; ${limited.length} draw(s) cut off or not run, reported as excluded, never as a loss`);
  const noise = rows.filter((r) => r.noise && r.outcome === 'scored');
  for (const t of [...new Set(noise.map((r) => r.task))]) {
    const b = get(t, 'bare');
    const g = [b?.outcome === 'scored' ? b.green : null, ...noise.filter((r) => r.task === t).map((r) => r.green)].filter((x) => x !== null);
    L.push(`Noise draws on ${t} (scored bare draws only, reported separately): green ${g.join(', ')}; spread ${Math.max(...g) - Math.min(...g)}`);
  }
  L.push('', CAVEAT);
  return L.join('\n');
}
