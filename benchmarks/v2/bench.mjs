#!/usr/bin/env node
// bench.mjs: benchmark v2. Is SoMi worth it against a bare agent on the same model, is 5.0 better than 4.1, and which parts pay? See
// docs/BENCHMARK.md for the design. A paid run needs --go. The test suite proves this driver with a stub agent and spends nothing.
//
//   bench.mjs plan   --phase pilot|aa|trial|baseline|candidate|ablation|large [--pilot DIR] [--seed N]    the draws and timeout, spends nothing
//   bench.mjs routes                                                                     scores the router on the labelled set, spends nothing
//   bench.mjs admit                                                                      every live task's admission and mutants, spends nothing
//   bench.mjs power  [--pilot DIR]                                                       draws per arm for each effect, spends nothing
//   bench.mjs run    --phase ... --out DIR --model ID --go --budget-total USD [--chunk 24] [--budget-draw USD] [--window-tokens N]
//                    [--worker-model ID] [--plugin-41 DIR] [--env-file FILE] [--timeout-min N] [--quiet-wait-min 90]
//                    [--claude PATH --no-sandbox --tasks ID,ID]   a stub agent, for proving the harness without spending anything
//   bench.mjs record takes what run takes: runs chunks to the end or a stop, then writes the record and the report skeleton
//   bench.mjs select --pilot DIR[,DIR] [--allow-short]                                      writes task-set.json from a pilot
//   bench.mjs prereg                                                                  binds task-set.json into prereg.json
//   bench.mjs report --out DIR [--write DIR]                                          prints the report, or writes the record
//   bench.mjs decide --aa DIR --baseline DIR --candidate DIR                                              the release rule; exit 0 only when it ships

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { admitTask } from '../../tests/evals/lib/admit.mjs';
import { buildPlugin, childEnv, classify, foldScore, looksPaused, prepareWorkspace, probeSandbox, readEnvFile, resolveBinary, runDraw, sandboxSpec, seededShuffle, taskText } from '../../tests/evals/lib/ab-draw.mjs';
import { inspectDraw } from '../../tests/evals/lib/ab-stream.mjs';
import { lstatManifest } from '../../tests/evals/lib/manifest.mjs';
import { scoreHidden } from '../../tests/evals/lib/score-hidden.mjs';
import { taskHash } from '../../tests/evals/lib/task-store.mjs';
import { armSummary, costDrawsPerArm, evaluateAa, evaluateRelease, logRatio, nonInferiorityDrawsPerArm, nonInferiorityPower, passDrawsPerArm, selectTasks, weightedTokens } from './stats.mjs';
import { adherence, agentSplit, labelDraw, scopeCheck } from './telemetry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CANDIDATES = path.join(HERE, 'candidates.json');
const TASK_SET = path.join(HERE, 'task-set.json');
const PREREG = path.join(HERE, 'prereg.json');
const ABLATIONS = path.join(HERE, 'ablations.json');
const MAX_CHUNK = 24;
const WINDOW_STOP_SHARE = 0.6;
const ABANDON_AFTER = 2;
const QUIET_LOAD_SHARE = 0.5;
const QUIET_WAIT_MIN = 90;
const QUIET_POLL_MS = 30000;
const ADMIT_TRIES = 3;
const MAX_FAILED_NAMES = 20;

export const PHASE_ARMS = Object.freeze({
  pilot: ['bare'],
  aa: ['bare-a', 'bare-b'],
  trial: ['somi5', 'somi41'],
  baseline: ['bare', 'somi41'],
  candidate: ['somi5', 'bare-check'],
  ablation: ['bare'],
  large: ['bare', 'somi5', 'somi5-lane', 'somi41'],
  tight: ['bare', 'somi5', 'somi5-lane'],
});

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const isBare = (arm) => arm.startsWith('bare');
// Every arm gets the same plain request. The SoMi arms go through their own front door, so routing is what gets measured, not a flow
// the benchmark picked for them. The one exception asks for a plan, as a maintainer can, because that is how the milestone lane is reached.
export const armPrompt = (arm, text) => (arm === 'somi5-lane' ? `Show me a plan first, then build it.\n${text}` : text);
const engineArm = (arm) => (isBare(arm) ? 'bare' : 'somi');
export const armsFor = (phase, cells = readJson(ABLATIONS).cells) => (phase === 'ablation' ? [...PHASE_ARMS.ablation, ...Object.keys(cells)] : PHASE_ARMS[phase]);

const drawsFor = (phase, reg) => ({ pilot: reg.pilot_k, aa: reg.aa_k, trial: reg.trial_k, ablation: reg.ablation_k, large: reg.large_k, tight: reg.tight_k })[phase] ?? reg.k;
const armKFor = (phase, reg) => (phase === 'candidate' ? reg.arm_k : {});
// The large phase runs on a window a long session can really fill. The tight phase makes the window small enough that every arm compacts,
// because no task we can write offline fills a large one: a model scripts uniform work and finishes short work in one pass.
// The host takes a window from 100000 to 1000000 and ignores anything else, so the tight phase lowers the point of compaction with its percentage instead.
// At 30 the host stops sessions as thrashing, because a session starts at about 20000 tokens and a worker's brief and files fill the rest.
export const WINDOW_SETTINGS = Object.freeze({ large: { autoCompactWindow: 120000 }, tight: { autoCompactWindow: 100000 } });
export const WINDOW_ENV = Object.freeze({ tight: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } });
export const liveCandidates = (tasks) => tasks.filter((t) => !t.retired);
function tasksFor(phase, only) {
  if (phase === 'pilot') { const all = readJson(CANDIDATES).tasks; return only ? all.filter((t) => only.includes(t.id)) : liveCandidates(all).filter((t) => !t.large); }
  if (phase === 'large' || phase === 'tight') return readJson(CANDIDATES).tasks.filter((t) => t.large);
  if (!fs.existsSync(TASK_SET)) throw new Error('no task-set.json yet: run the pilot, then select');
  const set = readJson(TASK_SET);
  return phase === 'trial' ? set.tasks.filter((t) => set.hardest.includes(t.id)).slice(0, 2) : set.tasks;
}

// Every arm of a task runs in the same round, in a seeded order, so drift over a long recording falls on all arms alike.
export function buildPlan(phase, tasks, seed = 1, k = 3, armK = {}) {
  const arms = armsFor(phase);
  const draws = [];
  for (let draw = 1; draw <= k; draw++) {
    for (const task of seededShuffle(tasks, seed + draw)) {
      for (const arm of seededShuffle(arms.filter((a) => draw <= (armK[a] ?? k)), seed + draw * 31)) draws.push({ id: `${task.id}.${arm}.${draw}`, task: task.id, dir: task.dir, arm, draw });
    }
  }
  return draws;
}

export function readResults(dir) {
  const file = path.join(dir, 'results.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Registration holds only when prereg.json names this exact task set and both files are committed and unchanged. A file the
// maintainer can still edit after seeing a number registers nothing.
export function preregProblem(repo = REPO, dir = HERE) {
  const prereg = path.join(dir, 'prereg.json');
  const set = path.join(dir, 'task-set.json');
  if (!fs.existsSync(prereg) || !fs.existsSync(set)) return 'prereg.json and task-set.json must both exist';
  if (readJson(prereg).task_set_sha256 !== sha256(fs.readFileSync(set))) return 'prereg.json does not name this task-set.json; run prereg';
  const rel = [prereg, set].map((f) => path.relative(repo, f));
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', ...rel], { cwd: repo, stdio: 'ignore' });
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...rel], { cwd: repo, encoding: 'utf8' });
    if (dirty.trim() !== '') return 'prereg.json or task-set.json has uncommitted changes';
  } catch { return 'prereg.json and task-set.json must be committed before the first paid main draw'; }
  return null;
}

// An alias can move to a new model between two recordings, and a calibration does not survive that, so a run is pinned to a full id
// and every model the draw reports must be that id, with at most a date suffix.
export const isFullModelId = (m) => /-\d/.test(m);
export const servedAsPinned = (served, pins) => served.every((m) => m === '<synthetic>' || pins.some((p) => m === p || (m.startsWith(`${p}-`) && /^\d{8}$/.test(m.slice(p.length + 1)))));

// Six plain fields so two recordings can be compared. Free text is reduced to a safe alphabet, so no name or path can survive into a record.
const safeText = (v) => String(v ?? '').replace(/[^A-Za-z0-9 ().,+@-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
export const hostFingerprint = () => ({ cpu: safeText(os.cpus()[0]?.model), cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), os: safeText(os.release()), node: safeText(process.version) });

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

// Result events come in runs within one CLI call, where usage is cumulative: the last of a run is the call's total.
export function streamUsage(file) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const spend = {};
  const models = new Set();
  let turns = 0;
  let compactions = 0;
  let pending = null;
  const flush = () => {
    for (const [name, m] of Object.entries(pending ?? {})) {
      spend[name] = (spend[name] ?? 0) + (m?.costUSD ?? 0);
      totals.input += m?.inputTokens ?? 0;
      totals.output += m?.outputTokens ?? 0;
      totals.cacheRead += m?.cacheReadInputTokens ?? 0;
      totals.cacheCreation += m?.cacheCreationInputTokens ?? 0;
    }
    pending = null;
  };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { tokens: totals, models: [], turns, spend, compactions }; }
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    if (ev?.type === 'system' && ev.subtype === 'compact_boundary') compactions++;
    if (ev?.type === 'result') {
      turns += Number.isFinite(ev.num_turns) ? ev.num_turns : 0;
      if (ev.modelUsage && typeof ev.modelUsage === 'object') {
        pending = ev.modelUsage;
        Object.keys(ev.modelUsage).forEach((m) => models.add(m));
      }
    } else flush();
  }
  flush();
  return { tokens: totals, models: [...models].sort(), turns, spend, compactions };
}

// The packed plugin is locked read-only, so it has to be unlocked before it can be removed.
function removeTree(dir) {
  const unlock = (d) => {
    fs.chmodSync(d, 0o700);
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) unlock(path.join(d, e.name));
  };
  try { unlock(dir); fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.error(`bench: could not remove ${dir}: ${e.code}`); }
}

// Hidden suites carry per-family time limits, and CPU contention breaks them. A draw on a busy machine would score the machine, so a
// recording waits for quiet and each row keeps the load it started under.
export const isQuiet = (load, cores, share = QUIET_LOAD_SHARE) => load <= cores * share;

async function waitForQuiet(minutes, stopped) {
  const deadline = Date.now() + minutes * 60000;
  let told = false;
  while (!isQuiet(os.loadavg()[0], os.cpus().length)) {
    if (stopped() || Date.now() > deadline) return false;
    if (!told) { console.log(`waiting for a quiet machine: load ${os.loadavg()[0].toFixed(1)} on ${os.cpus().length} cores`); told = true; }
    await new Promise((resolve) => { setTimeout(resolve, QUIET_POLL_MS); });
  }
  return true;
}

// Admission runs the reference solution through the same timed suites, so it gets a few tries. A task is refused only if all fail.
function admitWithRetries(dir, hash) {
  let last = 'no attempt';
  for (let i = 0; i < ADMIT_TRIES; i++) {
    const adm = admitTask(dir, { repeats: 1 });
    if (adm.ok && adm.hash === hash) return adm;
    last = adm.ok ? 'the task changed' : adm.reason;
  }
  throw new Error(`not admitted after ${ADMIT_TRIES} tries: ${String(last).slice(0, 200)}`);
}

// A recording's timeout comes from what the pilot measured. Only a bare arm is piloted, so a workflow arm's limit scales by the widest
// time overhead 4.1 recorded.
const WORKFLOW_TIME_MARGIN = 7;
export function timeoutFromPilot(rows) {
  const walls = rows.filter((r) => r.wall_ms > 0).map((r) => r.wall_ms).sort((a, b) => a - b);
  if (walls.length === 0) return null;
  const p95 = walls[Math.min(walls.length - 1, Math.ceil(walls.length * 0.95) - 1)];
  return { bare_min: Math.ceil((p95 * 1.5) / 60000), workflow_min: Math.ceil((p95 * 1.5 * WORKFLOW_TIME_MARGIN) / 60000) };
}

const scoreRow = (d, fields) => ({ schema: 2, draw: d.id, task: d.task, arm: d.arm, k: d.draw, ...fields });

export function abandonedArms(rows) {
  const out = new Set();
  const streak = new Map();
  for (const r of rows) {
    if (r.halted === 'account-limit') {
      const n = (streak.get(r.arm) ?? 0) + 1;
      streak.set(r.arm, n);
      if (n >= ABANDON_AFTER) out.add(r.arm);
    } else if (!r.halted) streak.set(r.arm, 0);
  }
  return out;
}

export const openDecisions = (prereg) => Object.entries(prereg.decisions ?? {}).filter(([, v]) => v === null).map(([k]) => k);
const transcriptsOf = (drawDir) => {
  const dir = path.join(drawDir, 'transcripts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
};
const readOr = (file, fallback = '') => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };
const ruleHash = () => sha256(JSON.stringify({ ...readJson(PREREG), task_set_sha256: null }));

async function run(args, session = { windowWeighted: 0 }) {
  const phase = args.phase;
  const prereg = readJson(PREREG);
  const stub = Boolean(args.claude);
  if (!args.go) throw new Error('a run spends real usage: pass --go once the maintainer has agreed the budget');
  if (!args.model || !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/.test(args.model)) throw new Error('--model is required');
  if (!stub && !isFullModelId(args.model)) throw new Error('--model must be a full model id, not an alias: an alias can move between recordings');
  const pins = [args.model, ...(args['worker-model'] ? [args['worker-model']] : [])];
  const alias = (id) => /haiku/.test(id) ? 'haiku' : /sonnet/.test(id) ? 'sonnet' : id;
  if ([args.model, args['worker-model']].some((m) => /opus/i.test(m ?? ''))) throw new Error('benchmarks never run on opus: the top model of any recording is sonnet');
  if (args.tasks && !stub && phase !== 'pilot') throw new Error('--tasks is for a pilot or a stub: a paid recording runs its whole plan');
  if (!args.out) throw new Error('--out is required');
  const budgetTotal = Number(args['budget-total']);
  if (!(budgetTotal > 0)) throw new Error('--budget-total is required');
  const budgetDraw = Number(args['budget-draw'] ?? 3);
  const chunk = Math.min(Number(args.chunk ?? MAX_CHUNK), MAX_CHUNK);
  if (['baseline', 'candidate', 'ablation', 'large', 'tight'].includes(phase)) {
    const problem = preregProblem();
    if (problem) throw new Error(problem);
  }
  if (PHASE_ARMS[phase].includes('somi41') && !args['plugin-41']) throw new Error(`${phase} needs --plugin-41, a packed 4.1 release`);
  if (phase !== 'pilot' && phase !== 'aa' && !stub && (!args['worker-model'] || !isFullModelId(args['worker-model']))) throw new Error('--worker-model is required: the low tier, by its full id');
  if (phase !== 'pilot' && !args['timeout-min']) throw new Error('--timeout-min is required: take it from `bench.mjs plan --pilot DIR`, not from a guess');
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is in the environment; the scorer must run without it');

  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const only = args.tasks ? args.tasks.split(',') : null;
  const plan = buildPlan(phase, tasksFor(phase, only), Number(args.seed ?? 1), drawsFor(phase, prereg), armKFor(phase, prereg));
  const resultsFile = path.join(out, 'results.jsonl');
  const planFile = path.join(out, 'plan.json');
  const planText = JSON.stringify({ phase, model: args.model, worker_model: args['worker-model'] ?? null, rule: ruleHash(), host: hostFingerprint(), draws: plan.map((d) => d.id) });
  if (fs.existsSync(planFile) && fs.readFileSync(planFile, 'utf8') !== planText) throw new Error('--out holds a different plan');
  fs.writeFileSync(planFile, planText);

  const done = readResults(out);
  const finished = new Set(done.filter((r) => !r.halted).map((r) => r.draw));
  const home = process.env.HOME ?? os.homedir();
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-v2-'));
  process.on('exit', () => removeTree(runTmp));
  const ablations = readJson(ABLATIONS);
  const plugins = new Map();
  const pluginOf = (arm) => {
    if (isBare(arm)) return null;
    if (arm === 'somi41') return path.resolve(args['plugin-41']);
    if (!plugins.has(arm)) plugins.set(arm, buildPlugin({ repoRoot: REPO, runTmp, dirName: `plugin-${arm}`, patches: (ablations.cells[arm] ?? ablations.large_cells[arm] ?? []).map((name) => ablations.patches[name]) }));
    return plugins.get(arm);
  };
  const env = readEnvFile(path.resolve(args['env-file'] ?? path.join(REPO, '.somi/eval.env')));
  if (!env.ok) throw new Error(env.reason);
  // The agent runs with bypassed permissions, so the sandbox can only be dropped for a stub the caller names.
  if (args['no-sandbox'] && !args.claude) throw new Error('--no-sandbox needs --claude, a stub');
  const claude = args.claude ? path.resolve(args.claude) : resolveBinary('claude');
  if (!claude || (!args['no-sandbox'] && resolveBinary('bwrap') === null)) throw new Error('claude and bubblewrap are both required');
  const specFor = (arm) => (args['no-sandbox'] ? null : sandboxSpec({ home, repoRoot: REPO, claudeReal: claude, plugin: pluginOf(arm) }));
  if (!args['no-sandbox'] && !probeSandbox(specFor('bare'))) throw new Error('bubblewrap is not usable here');

  const admitted = new Map();
  const kills = new Set();
  let interrupted = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { interrupted = true; kills.forEach((k) => k()); });
  const rows = [...done];
  const left = plan.filter((d) => !finished.has(d.id)).length;
  console.log(`worst case: ${left} draws at $${budgetDraw} each is $${(left * budgetDraw).toFixed(2)}, capped by the total of $${budgetTotal}`);
  let stop = null;
  let spent = done.reduce((s, r) => s + (r.cost ?? 0), 0);
  let ran = 0;

  for (const d of plan) {
    if (finished.has(d.id)) continue;
    if (abandonedArms(rows).has(d.arm)) {
      const row = scoreRow(d, { outcome: 'no-valid-score', solved: false, abandoned: true, weighted: 0, cost: 0, wall_ms: 0, turns: 0 });
      fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      rows.push(row);
      continue;
    }
    if (interrupted || ran >= chunk) break;
    if (spent + budgetDraw > budgetTotal) { stop = 'budget'; console.log(`budget stop: spent $${spent.toFixed(2)} of $${budgetTotal}`); break; }
    const windowTokens = Number(args['window-tokens']);
    if (windowTokens > 0 && session.windowWeighted >= windowTokens * WINDOW_STOP_SHARE) { stop = 'window'; console.log('window stop: this session used 60% of the stated window; run it again in the next window'); break; }

    if (!stub && !await waitForQuiet(Number(args['quiet-wait-min'] ?? QUIET_WAIT_MIN), () => interrupted)) { stop = 'quiet'; console.log('quiet stop: the machine stayed busy, so this chunk ends here; run it again later'); break; }
    const load = Number(os.loadavg()[0].toFixed(1));
    const dir = path.join(REPO, d.dir);
    if (!admitted.has(dir)) {
      const th = taskHash(dir);
      if (!th.ok) throw new Error(`task ${d.task}: ${th.reason}`);
      const adm = admitWithRetries(dir, th.hash);
      admitted.set(dir, { task: th.task, hash: adm.hash, expect: { total: adm.total, names: adm.names } });
    }
    const t = admitted.get(dir);
    const drawDir = path.join(out, d.id);
    fs.mkdirSync(drawDir, { recursive: true, mode: 0o700 });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-v2-draw-'));
    console.log(`start ${d.id}`);
    try {
      const config = { cost: { ceiling: 'medium' }, tiers: { claude: { low: alias(args['worker-model'] ?? args.model), medium: alias(args.model), high: alias(args.model) } } };
      const { ws, before } = prepareWorkspace({ taskDir: dir, tmp, config, globalConfig: config });
      const result = await runDraw({
        model: args.model, arm: engineArm(d.arm), prompt: armPrompt(d.arm, taskText(t.task)), budget: budgetDraw, timeoutMs: Number(args['timeout-min'] ?? 40) * 60000,
        settings: WINDOW_SETTINGS[phase], maxResumes: 6, claude, env: { ...childEnv({ token: env.token, tmp }), ...WINDOW_ENV[phase] }, cwd: ws, plugin: pluginOf(d.arm), drawDir, token: env.token, canary: t.task.canary, task: t.task, absAb: path.dirname(dir), ownTmp: tmp, kills, sandbox: specFor(d.arm),
      });
      if (interrupted) { stop = 'interrupted'; break; }
      const after = lstatManifest(ws);
      result.leaks = [...new Set([...result.leaks, ...inspectDraw({ ws, cfg: path.join(tmp, 'cfg'), after, drawDir, token: env.token, canary: t.task.canary, absAb: path.dirname(dir) })])];
      const cls = classify({ run: result, arm: engineArm(d.arm), budget: budgetDraw });
      const usage = streamUsage(path.join(drawDir, 'stream.jsonl'));
      const measured = { cost: result.cost, wall_ms: result.wallMs ?? 0, turns: usage.turns, tokens: usage.tokens, weighted: weightedTokens(usage.tokens), models: usage.models, spend: usage.spend, compactions: usage.compactions };
      spent += measured.cost;
      session.windowWeighted += measured.weighted;
      ran++;
      let row;
      if (cls.outcome === 'invalid' && /^(account-limit|bg-wait-ceiling|auth|spawn-error|no-result)/.test(cls.reason)) {
        row = scoreRow(d, { halted: cls.reason.split(':')[0], ...measured });
        fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
        rows.push(row);
        console.log(`halted ${d.id}: ${row.halted}`);
        if (row.halted !== 'account-limit' || !abandonedArms(rows).has(d.arm)) { stop = row.halted; break; }
        continue;
      }
      const scratch = { draw: d.id, outcome: cls.outcome, reason: cls.reason, green: 0 };
      const sc = scoreHidden({ workspace: ws, taskDir: dir, admittedHash: t.hash, expect: t.expect });
      if (!sc.ok) throw new Error(`the scorer failed on ${d.id}: ${sc.reason}`);
      const halt = foldScore(scratch, sc);
      const streamText = readOr(path.join(drawDir, 'stream.jsonl'));
      const adh = adherence(streamText, readOr(path.join(ws, '.somi/state/journal.jsonl')));
      const scope = scopeCheck(before.files, after?.ok ? after.files : before.files, t.task);
      const { label, gate } = labelDraw({ outcome: scratch.outcome, reason: scratch.reason, facts: adh, paused: looksPaused(result.text), changed: scope.touched.length + scope.added.length > 0 || gitChanged(ws) });
      const solved = label === 'finished' && scope.touched.length === 0 && scratch.outcome === 'scored' && sc.total > 0 && scratch.green === sc.total && !Object.values(scratch.flags ?? {}).some(Boolean);
      const split = agentSplit(streamText, transcriptsOf(drawDir), measured.weighted);
      if (!servedAsPinned(measured.models, pins)) { scratch.outcome = 'invalid'; scratch.reason = 'model-pin'; }
      row = scoreRow(d, { outcome: scratch.outcome, reason: scratch.reason, label: scratch.reason === 'model-pin' ? 'invalid' : label, gate, green: scratch.green, total: sc.total, solved: solved && scratch.reason !== 'model-pin', scope, adherence: adh, agents: split.agents, split_coverage: split.coverage, failed: (scratch.failedNames ?? []).slice(0, MAX_FAILED_NAMES), flags: scratch.flags, load, ...measured });
      fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      rows.push(row);
      console.log(`done ${d.id}: ${solved ? 'solved' : 'not solved'}, $${measured.cost.toFixed(3)}`);
      if (halt) throw new Error(halt);
      if (scratch.reason === 'model-pin') throw new Error(`${d.id}: served ${measured.models.join(', ')}, not the pinned model`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const remaining = plan.length - rows.filter((r) => !r.halted).length;
  console.log(`this chunk ran ${ran} draws; ${remaining} remain`);
  return { ran, remaining, stop };
}

const gitChanged = (ws) => {
  try { return execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude).somi'], { cwd: ws, encoding: 'utf8' }).trim() !== ''; } catch { return false; }
};

const completed = (dir) => readResults(dir).filter((r) => !r.halted).map((r) => ({ ...r, draw: r.k }));

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
  const meta = (d) => { const { model, rule, host } = readJson(path.join(d, 'plan.json')); return JSON.stringify({ model, rule, host }); };
  return meta(aaDir) === meta(mainDir) ? null : 'the A/A and main recordings differ in model, rule or host, so they cannot be compared';
}

const fmt = (x, digits = 2) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(digits));
const ratioCell = (r) => (r.ratio === null ? 'n/a' : `${fmt(r.ratio)} (${fmt(r.lower)} to ${fmt(r.upper)})`);

export function renderReport(dir) {
  const rows = completed(dir);
  const planned = readJson(path.join(dir, 'plan.json'));
  const reg = readJson(PREREG);
  const k = drawsFor(planned.phase, reg);
  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  const base = arms.includes('bare') ? 'bare' : arms[0];
  const out = [`# Benchmark record: ${planned.phase}`, '', `- Session model: ${planned.model}${planned.worker_model ? `, low tier ${planned.worker_model}` : ''}`, `- Rule hash: ${planned.rule}`, `- Host: ${JSON.stringify(planned.host)}`, `- Draws recorded: ${rows.length} of ${planned.draws.length}. Dollars are the CLI's estimate.`, '', '## Arms', '', '| Arm | Draws | Solved | pass@1 | pass^k | Weighted per solved | Dollars per solved | Minutes per solved | Labels |', '|---|---|---|---|---|---|---|---|---|'];
  for (const arm of arms) {
    const a = armSummary(rows, arm, planned.phase === 'candidate' ? reg.arm_k[arm] ?? k : k);
    out.push(`| ${arm} | ${a.draws} | ${a.solved} | ${fmt(a.pass_at_1)} | ${fmt(a.pass_all_k)} | ${fmt(a.weighted_per_solved, 0)} | ${fmt(a.cost_per_solved, 3)} | ${a.wall_ms_per_solved === null ? 'n/a' : fmt(a.wall_ms_per_solved / 60000, 1)} | ${JSON.stringify(a.labels)} |`);
  }
  const others = arms.filter((a) => a !== base);
  if (others.length > 0) {
    out.push('', `## Against ${base}`, '', 'Ratios are per draw, blocked by task, with a 90% interval.', '', '| Arm | Weighted tokens | Dollars | Wall time |', '|---|---|---|---|');
    for (const arm of others) out.push(`| ${arm} | ${ratioCell(logRatio(rows, arm, base, 'weighted'))} | ${ratioCell(logRatio(rows, arm, base, 'cost'))} | ${ratioCell(logRatio(rows, arm, base, 'wall_ms'))} |`);
  }
  if (arms.includes('bare-a')) {
    const aa = evaluateAa(rows, k);
    out.push('', '## Noise floor', '', `A/A difference ${fmt(aa.mean)} (95% ${fmt(aa.lower)} to ${fmt(aa.upper)}), ${aa.contains_zero ? 'contains zero' : 'EXCLUDES ZERO'}. Tokens: ${ratioCell(logRatio(rows, 'bare-a', 'bare-b'))}.`);
  }
  out.push('', '## Protocol and spend', '', '| Arm | Routed to | Tool or CLI | Closed | Mean passes | Gates | Escalated | Inline writes | Findings | Mean dollars per model | Mean weighted per agent | Split coverage |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of arms) {
    const list = rows.filter((r) => r.arm === arm && r.adherence);
    const count = (f) => list.reduce((acc, r) => { for (const key of f(r)) acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
    const perAgent = {};
    for (const r of list) for (const [name, a] of Object.entries(r.agents ?? {})) perAgent[name] = (perAgent[name] ?? 0) + a.weighted / list.length;
    const findings = {};
    for (const r of list) for (const [s, n] of Object.entries(r.adherence.findings)) findings[s] = (findings[s] ?? 0) + n;
    const cover = list.map((r) => r.split_coverage).filter((c) => c !== null);
    const spend = {};
    for (const r of list) for (const [m, usd] of Object.entries(r.spend ?? {})) spend[m] = (spend[m] ?? 0) + usd / list.length;
    out.push(`| ${arm} | ${JSON.stringify(count((r) => (r.adherence.routed ? [r.adherence.routed] : [])))} | ${JSON.stringify(count((r) => [r.adherence.route]))} | ${list.filter((r) => r.adherence.closed).length} | ${fmt(list.reduce((s, r) => s + r.adherence.passes, 0) / (list.length || 1))} | ${JSON.stringify(count((r) => r.adherence.gates))} | ${list.filter((r) => r.adherence.escalated).length} | ${list.reduce((s, r) => s + (r.adherence.inline_writes ?? 0), 0)} | ${JSON.stringify(findings)} | ${JSON.stringify(Object.fromEntries(Object.entries(spend).map(([m, v]) => [m, +v.toFixed(4)])))} | ${JSON.stringify(Object.fromEntries(Object.entries(perAgent).map(([n, w]) => [n, Math.round(w)])))} | ${fmt(cover.length ? Math.min(...cover) : null)} |`);
  }
  out.push('', '## Reading', '', 'To be written by a person: read 10 transcripts first, then say what the figures mean. An inconclusive result is published as inconclusive, with every figure.', '');
  return out.join('\n');
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

// One command: chunks to the end of the plan or to a stop, then the record. A stop leaves the draws in place, and running it again resumes.
async function record(args) {
  const session = { windowWeighted: 0 };
  for (;;) {
    const r = await run(args, session);
    if (r.stop) { console.log(`stopped: ${r.stop}. Run the same command again to resume.`); return 1; }
    if (r.remaining === 0 || r.ran === 0) break;
  }
  return writeRecord(path.resolve(args.out), args.write ?? path.join(HERE, 'records')) ? 0 : 1;
}

function renderPower(pilotRows) {
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

async function main(argv) {
  const [command, ...rest] = argv;
  const { values: args } = parseArgs({
    args: rest,
    options: {
      phase: { type: 'string' }, out: { type: 'string' }, model: { type: 'string' }, seed: { type: 'string' }, go: { type: 'boolean' }, chunk: { type: 'string' },
      'budget-total': { type: 'string' }, 'budget-draw': { type: 'string' }, 'window-tokens': { type: 'string' }, 'plugin-41': { type: 'string' }, 'env-file': { type: 'string' },
      'timeout-min': { type: 'string' }, 'worker-model': { type: 'string' }, baseline: { type: 'string' }, candidate: { type: 'string' }, tasks: { type: 'string' }, write: { type: 'string' }, 'quiet-wait-min': { type: 'string' }, claude: { type: 'string' }, 'no-sandbox': { type: 'boolean' }, pilot: { type: 'string' }, 'allow-short': { type: 'boolean' }, aa: { type: 'string' }, main: { type: 'string' },
    },
  });
  if (command === 'plan' || command === 'run' || command === 'record') {
    if (!Object.hasOwn(PHASE_ARMS, args.phase ?? '')) throw new Error(`--phase takes ${Object.keys(PHASE_ARMS).join(', ')}`);
    if (command === 'run') return (await run(args)).stop ? 1 : 0;
    if (command === 'record') return record(args);
    const prereg = readJson(PREREG);
    const plan = buildPlan(args.phase, tasksFor(args.phase), Number(args.seed ?? 1), drawsFor(args.phase, prereg), armKFor(args.phase, prereg));
    console.log(`${plan.length} draws across ${new Set(plan.map((d) => d.task)).size} tasks; chunks of at most ${MAX_CHUNK}; no spend`);
    if (args.pilot) console.log(`timeout from the pilot: ${JSON.stringify(timeoutFromPilot(completed(args.pilot)))} minutes`);
    plan.forEach((d) => console.log(`  ${d.id}`));
    return 0;
  }
  if (command === 'select') {
    if (!args.pilot) throw new Error('--pilot is required');
    const reg = readJson(PREREG);
    const picked = selectTasks(pilotRows(args.pilot.split(',')), liveCandidates(readJson(CANDIDATES).tasks), { mix: reg.mix, minBoundary: reg.min_boundary, k: reg.pilot_k });
    console.log(JSON.stringify({ kept: picked.tasks.length, boundary: picked.boundary, strata: picked.strata, shortfalls: picked.shortfalls }));
    if (picked.shortfalls.length > 0 && !args['allow-short']) { console.error('the set falls short; author more tasks, or pass --allow-short to record the shortfall'); return 1; }
    fs.writeFileSync(TASK_SET, `${JSON.stringify({ tasks: picked.tasks, hardest: picked.hardest, shortfalls: picked.shortfalls }, null, 2)}\n`);
    return 0;
  }
  if (command === 'prereg') {
    const prereg = readJson(PREREG);
    const open = openDecisions(prereg);
    if (open.length > 0) throw new Error(`these decisions are still open: ${open.join(', ')}`);
    prereg.task_set_sha256 = sha256(fs.readFileSync(TASK_SET));
    fs.writeFileSync(PREREG, `${JSON.stringify(prereg, null, 2)}\n`);
    console.log(`bound ${prereg.task_set_sha256}; commit prereg.json and task-set.json before the first paid main draw`);
    return 0;
  }
  if (command === 'report') {
    if (!args.out) throw new Error('--out is required');
    if (args.write) return writeRecord(args.out, args.write) ? 0 : 1;
    console.log(renderReport(args.out));
    return 0;
  }
  if (command === 'decide') {
    if (!args.aa || !args.baseline || !args.candidate) throw new Error('--aa, --baseline and --candidate are required');
    const problem = preregProblem() ?? comparableRecordings(args.aa, args.baseline) ?? comparableRecordings(args.baseline, args.candidate);
    if (problem) throw new Error(problem);
    const reg = readJson(PREREG);
    const [base, cand] = [completed(args.baseline), completed(args.candidate)];
    const verdict = evaluateRelease({ aa: completed(args.aa), main: [...base, ...cand], rule: { ...reg.rule, min_tasks: reg.tasks_wanted, k: reg.k, aa_k: reg.aa_k } });
    verdict.against_41 = { dollars: logRatio([...base, ...cand], 'somi5', 'somi41', 'cost'), tokens: logRatio([...base, ...cand], 'somi5', 'somi41') };
    verdict.bare_drift = logRatio([...cand, ...base], 'bare-check', 'bare', 'cost');
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.ships ? 0 : 1;
  }
  // Free and deterministic, and too slow for the fast gate: every suite runs against each reference solution, the empty fixture and each mutant.
  if (command === 'admit') {
    let refused = 0;
    for (const t of liveCandidates(readJson(CANDIDATES).tasks)) {
      const dir = path.join(REPO, t.dir);
      const r = admitTask(dir, { mutants: readJson(`${dir}.mutants.json`), repeats: 1 });
      if (!r.ok) refused++;
      console.log(`${t.id}: ${r.ok ? `admitted, ${r.total} tests, ${r.mutantsKilled.length} mutants killed` : `REFUSED ${r.reason}`}`);
    }
    return refused ? 1 : 0;
  }
  if (command === 'routes') {
    const { scoreRouter } = await import('./routing-score.mjs');
    console.log(JSON.stringify(scoreRouter(readJson(path.join(HERE, 'routes.json')).items), null, 1));
    return 0;
  }
  if (command === 'power') {
    console.log(renderPower(args.pilot ? readResults(args.pilot) : []));
    return 0;
  }
  throw new Error('bench takes plan, admit, routes, power, run, record, select, prereg, report or decide');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`bench: ${e.message}`); process.exitCode = 1; });
}
