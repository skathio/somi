// report.mjs: what a recording says. The report a person reads, the record that is committed, and the privacy scan that stands between
// the two and anything that is not meant to leave this machine.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PREREG, drawsFor, readJson, readResults, timeoutFromPilot } from './config.mjs';
import { COST_TIE, TEST_VALIDITY_KILL, rankArms } from './scoring.mjs';
import { armSummary, costDrawsPerArm, evaluateAa, logRatio, nonInferiorityDrawsPerArm, nonInferiorityPower, passDrawsPerArm } from './stats.mjs';

// The scan on anything meant to be committed. It names the place and the kind, never the string.
const LEAKS = [[/sk-[A-Za-z0-9_-]{8,}/, 'token-like string'], [/gh[pousr]_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}/, 'token-like string'], [/Bearer\s+\S{10,}/i, 'bearer token'], [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'private key'], [/\/(?:home|Users|root)\/[^\s/]+|[A-Za-z]:\\+Users\\+/, 'home path']];
export function findLeaks(value, at = 'record', hostname = os.hostname()) {
  if (typeof value === 'string') {
    const hit = LEAKS.find(([re]) => re.test(value));
    if (hit) return [{ at, kind: hit[1] }];
    return hostname.length >= 4 && value.includes(hostname) ? [{ at, kind: 'hostname' }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findLeaks(v, `${at}[${i}]`, hostname));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [...findLeaks(k, `${at}.<key>`, hostname), ...findLeaks(v, `${at}.${k}`, hostname)]);
  return [];
}


export const completed = (dir) => readResults(dir).filter((r) => !r.halted).map((r) => ({ ...r, draw: r.k }));

// Several pilots read as one. A task edited after its probe is probed again, and only its newest draws count, so a later directory replaces
// an earlier one task by task.
export function pilotRows(dirs, read = completed) {
  const byTaskId = new Map();
  for (const dir of dirs) {
    const groups = Map.groupBy(read(dir), (r) => r.task);
    for (const [task, rows] of groups) byTaskId.set(task, rows);
  }
  return [...byTaskId.values()].flat();
}

// A comparison across recordings means nothing unless both ran on the same model, the same host and the same rule.
export function comparableRecordings(aaDir, mainDir) {
  const meta = (d) => { const { model, worker_model, rule, host } = readJson(path.join(d, 'plan.json')); return JSON.stringify({ model, worker_model, rule, host }); };
  return meta(aaDir) === meta(mainDir) ? null : 'the A/A and main recordings differ in model, rule or host, so they cannot be compared';
}

const fmt = (x, digits = 2) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(digits));
const ratioCell = (r) => (r.ratio === null ? 'n/a' : `${fmt(r.ratio)} (${fmt(r.lower)} to ${fmt(r.upper)})`);


function resultsFirst(rows) {
  const ranked = rankArms(rows);
  const gateScored = ranked.some((a) => a.G !== null);
  return ['## Results first', '', `Ranked by strict successes, then by correct work with valid tests, then by cost (within ${COST_TIE * 100}% is a tie). Tests are valid when the cases that pass on the reference solution kill at least ${TEST_VALIDITY_KILL * 100}% of its mutants; a case that fails on the reference does not count.${gateScored ? '' : ' The quality gate is not scored yet, so a strict success here is hidden tests passed with valid tests.'}`, '', '| Rank | Arm | Draws | Hidden tests pass | Own tests valid | Both | Quality gate | Strict successes | Mean dollars | On the cost front |', '|---|---|---|---|---|---|---|---|---|---|', ...ranked.map((a, i) => `| ${i + 1} | ${a.arm} | ${a.draws} | ${a.P} | ${a.V} | ${a.PV} | ${a.G === null ? 'not scored' : a.G} | ${a.strict} | ${fmt(a.cost, 3)} | ${a.front ? 'yes' : 'no'} |`), ''];
}

function armsTable(rows, arms, { planned, reg, k }) {
  const out = ['## Arms', '', '| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |', '|---|---|---|---|---|---|---|---|---|'];
  for (const arm of arms) {
    const a = armSummary(rows, arm, planned.phase === 'candidate' ? reg.arm_k[arm] ?? k : k);
    out.push(`| ${arm} | ${a.draws} | ${a.solved} | ${fmt(a.pass_at_1)} | ${fmt(a.pass_all_k)} | ${fmt(a.weighted_per_solved, 0)} | ${fmt(a.cost_per_solved, 3)} | ${a.wall_ms_per_solved === null ? 'n/a' : fmt(a.wall_ms_per_solved / 60000, 1)} | ${JSON.stringify(a.labels)} |`);
  }
  return out;
}

function againstBase(rows, arms, base) {
  const others = arms.filter((a) => a !== base);
  if (others.length === 0) return [];
  return ['', `## Against ${base}`, '', 'Ratios are per draw, blocked by task, with a 90% interval.', '', '| Arm | Weighted tokens | Dollars | Wall time |', '|---|---|---|---|', ...others.map((arm) => `| ${arm} | ${ratioCell(logRatio(rows, arm, base, 'weighted'))} | ${ratioCell(logRatio(rows, arm, base, 'cost'))} | ${ratioCell(logRatio(rows, arm, base, 'wall_ms'))} |`)];
}

function noiseFloor(rows, arms, k) {
  if (!arms.includes('bare-a')) return [];
  const aa = evaluateAa(rows, k);
  return ['', '## Noise floor', '', `A/A difference ${fmt(aa.mean)} (95% ${fmt(aa.lower)} to ${fmt(aa.upper)}), ${aa.contains_zero ? 'contains zero' : 'EXCLUDES ZERO'}. Tokens: ${ratioCell(logRatio(rows, 'bare-a', 'bare-b'))}.`];
}

function ownTestsRow(rows, arm) {
  const list = rows.filter((r) => r.arm === arm && r.own_tests);
  const wrote = list.filter((r) => r.own_tests.tests > 0);
  const cases = wrote.reduce((s, r) => s + (r.own_tests.cases ?? 0), 0);
  const agree = wrote.reduce((s, r) => s + (r.own_tests.agree ?? 0), 0);
  const scored = wrote.filter((r) => (r.own_tests.agree ?? 0) > 0);
  const killed = scored.reduce((s, r) => s + r.own_tests.killed, 0);
  const total = scored.reduce((s, r) => s + r.own_tests.total, 0);
  const pct = (a, b) => (b ? `${a} of ${b} (${Math.round((100 * a) / b)}%)` : 'n/a');
  return `| ${arm} | ${wrote.length} of ${list.length} | ${pct(agree, cases)} | ${pct(killed, total)} |`;
}

const meanPer = (list, entries) => {
  const out = {};
  for (const r of list) for (const [key, v] of entries(r)) out[key] = (out[key] ?? 0) + v / list.length;
  return out;
};

function protocolRow(rows, arm) {
  const list = rows.filter((r) => r.arm === arm && r.adherence);
  const count = (f) => list.reduce((acc, r) => { for (const key of f(r)) acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const perAgent = meanPer(list, (r) => Object.entries(r.agents ?? {}).map(([name, a]) => [name, a.weighted]));
  const findings = {};
  for (const r of list) for (const [s, n] of Object.entries(r.adherence.findings)) findings[s] = (findings[s] ?? 0) + n;
  const cover = list.map((r) => r.split_coverage).filter((c) => c !== null);
  const spend = meanPer(list, (r) => Object.entries(r.spend ?? {}));
  return `| ${arm} | ${JSON.stringify(count((r) => (r.adherence.routed ? [r.adherence.routed] : [])))} | ${JSON.stringify(count((r) => [r.adherence.route]))} | ${fmt(list.reduce((s, r) => s + r.adherence.passes, 0) / (list.length || 1))} | ${JSON.stringify(count((r) => r.adherence.gates))} | ${list.filter((r) => r.adherence.escalated).length} | ${list.reduce((s, r) => s + (r.adherence.inline_writes ?? 0), 0)} | ${JSON.stringify(findings)} | ${JSON.stringify(Object.fromEntries(Object.entries(spend).map(([m, v]) => [m, +v.toFixed(4)])))} | ${JSON.stringify(Object.fromEntries(Object.entries(perAgent).map(([n, w]) => [n, Math.round(w)])))} | ${fmt(cover.length ? Math.min(...cover) : null)} |`;
}

export function renderReport(dir) {
  const rows = completed(dir);
  const planned = readJson(path.join(dir, 'plan.json'));
  const reg = readJson(PREREG);
  const k = drawsFor(planned.phase, reg);
  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  const base = arms.includes('bare') ? 'bare' : arms[0];
  return [
    `# Benchmark record: ${planned.phase}`, '', `- Session model: ${planned.model}${planned.worker_model ? `, low tier ${planned.worker_model}` : ''}`, `- Rule hash: ${planned.rule}`, `- Host: ${JSON.stringify(planned.host)}`, `- Draws recorded: ${rows.length} of ${planned.draws.length}. Dollars are the CLI's estimate.`, '',
    ...resultsFirst(rows),
    ...armsTable(rows, arms, { planned, reg, k }),
    ...againstBase(rows, arms, base),
    ...noiseFloor(rows, arms, k),
    '', '## Own tests', '', 'Tests each draw added or changed, run case by case on the reference solution and on each of its recorded mutants. A case that fails on the reference pins something the reference does differently, often a detail the task leaves open, and is left out. Mutants are counted for draws with at least one agreeing case.', '', '| Arm | Draws with tests | Cases agreeing with the reference | Mutants killed |', '|---|---|---|---|', ...arms.map((arm) => ownTestsRow(rows, arm)),
    '', '## Protocol and spend', '', '| Arm | Routed to | Tool or CLI | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |', '|---|---|---|---|---|---|---|---|---|---|---|---|', ...arms.map((arm) => protocolRow(rows, arm)),
    '', '## Reading', '', 'To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.', '',
  ].join('\n');
}

// The committed record is rows plus the report. It holds no stream or transcript, and the privacy scan refuses to write anything it flags.
export function writeRecord(dir, target) {
  const rows = readResults(dir);
  const planned = readJson(path.join(dir, 'plan.json'));
  const report = renderReport(dir);
  const record = { schema: 2, plan: planned, rows };
  const leaks = [...findLeaks(record), ...findLeaks(report, 'report')];
  if (leaks.length > 0) { console.error(`privacy scan refused the record: ${JSON.stringify(leaks.slice(0, 10))}`); return false; }
  fs.mkdirSync(target, { recursive: true });
  const stem = path.join(target, `${planned.phase}-${planned.rule.slice(0, 12)}`);
  fs.writeFileSync(`${stem}.json`, `${JSON.stringify(record, null, 1)}\n`);
  fs.writeFileSync(`${stem}.md`, report);
  console.log(`wrote ${path.basename(stem)}.json and .md`);
  return true;
}

export function renderPower(pilotRows) {
  const out = ['Cost or tokens, draws per arm (90% interval, 80% power), bare spread 0.15:', '', '| Workflow arm spread | 50% | 30% | 25% | 20% |', '|---|---|---|---|---|'];
  for (const sigmaB of [0.15, 0.41, 0.8, 1.2]) out.push(`| ${sigmaB} | ${[0.5, 0.3, 0.25, 0.2].map((effect) => costDrawsPerArm({ sigmaA: 0.15, sigmaB, effect })).join(' | ')} |`);
  out.push('', 'Pass rate difference at a 50% baseline, draws per arm (95%, 80% power, no pairing gain):', '', `+20 points ${passDrawsPerArm({ p1: 0.5, p2: 0.7 })}, +10 points ${passDrawsPerArm({ p1: 0.5, p2: 0.6 })}`, '', 'Chance that a lane truly equal to bare clears a pass-rate margin:', '', '| Margin | 60 draws per arm | 96 | 128 | Draws per arm for 80% |', '|---|---|---|---|---|');
  for (const margin of [-0.05, -0.1, -0.15, -0.2]) out.push(`| ${margin * 100} points | ${[60, 96, 128].map((drawsPerArm) => fmt(nonInferiorityPower({ margin, drawsPerArm }))).join(' | ')} | ${nonInferiorityDrawsPerArm({ margin, sd: 0.5 })} |`);
  out.push('', 'Share of hidden tests passed, draws per arm for a -5 point margin at 80%:', '', [0.08, 0.15, 0.25].map((sd) => `spread ${sd}: ${nonInferiorityDrawsPerArm({ margin: -0.05, sd })}`).join(', '));
  const rows = pilotRows.filter((r) => r.wall_ms > 0);
  if (rows.length > 0) {
    const mean = (key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0) / rows.length;
    out.push('', `Pilot, bare, per draw: ${fmt(mean('wall_ms') / 60000, 1)} minutes, ${fmt(mean('weighted'), 0)} weighted tokens, $${fmt(mean('cost'), 3)}. Timeout from it: ${JSON.stringify(timeoutFromPilot(rows))} minutes.`);
  }
  return out.join('\n');
}

