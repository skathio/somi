// run.mjs: a recording, one chunk of draws at a time. Every refusal here guards spending: a paid run needs --go, never runs on the
// top model, runs in the sandbox unless a stub is named, and stops on a budget, the host's usage, the stated window or a busy machine,
// leaving what ran in place so that running it again resumes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, readEnvFile, runDraw } from '../../tests/evals/lib/ab-draw.mjs';
import { buildPlugin, probeSandbox, resolveBinary, sandboxSpec } from '../../tests/evals/lib/ab-sandbox.mjs';
import { inspectDraw } from '../../tests/evals/lib/ab-stream.mjs';
import { lstatManifest } from '../../tests/evals/lib/manifest.mjs';
import { ABLATIONS, HERE, HOST_STOP_SHARE, MAX_CHUNK, PHASE_ARMS, PREREG, QUIET_LOAD_SHARE, QUIET_POLL_MS, QUIET_WAIT_MIN, REPO, WINDOW_STOP_SHARE, abandonedArms, armKFor, buildPlan, drawsFor, engineArm, hostFingerprint, isBare, isFullModelId, preregProblem, readJson, readResults, ruleHash, scoreRow, tasksFor } from './config.mjs';
import { admittedTask, drawRequest, prepareDraw, scoreDraw } from './draw.mjs';
import { writeRecord } from './report.mjs';
import { scoreQuality } from './scoring.mjs';
import { weightedTokens } from './stats.mjs';
import { hostStop, hostWindows, streamUsage } from './usage.mjs';

// The packed plugin is locked read-only, and a draw can leave a directory nobody may read, so a tree is unlocked before it is removed.
export function removeTree(dir) {
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

// The refusals run in this order, each with the message it always had.
function checkModels(args, stub) {
  if (!args.go) throw new Error('a run spends real usage: pass --go once the maintainer has agreed the budget');
  if (!args.model || !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/.test(args.model)) throw new Error('--model is required');
  if (!stub && !isFullModelId(args.model)) throw new Error('--model must be a full model id, not an alias: an alias can move between recordings');
  if ([args.model, args['worker-model']].some((m) => /opus/i.test(m ?? ''))) throw new Error('benchmarks never run on opus: the top model of any recording is sonnet');
}

function checkScope(args, phase, stub) {
  if (args.tasks && !stub && phase !== 'pilot' && phase !== 'smoke') throw new Error('--tasks is for a pilot, a smoke or a stub: a paid recording runs its whole plan');
  if ((args.arms || args.k) && phase !== 'large' && phase !== 'smoke') throw new Error('--arms and --k are for an exploratory look: a registered recording runs its whole plan');
  if (!args.out) throw new Error('--out is required');
}

function stopShare(args, flag) {
  if (args[flag] === undefined) return HOST_STOP_SHARE;
  const v = Number(args[flag]);
  if (!(v > 0 && v < 1)) throw new Error(`--${flag} takes a share between 0 and 1, such as 0.85`);
  return v;
}

function budgets(args) {
  const total = Number(args['budget-total']);
  if (!(total > 0)) throw new Error('--budget-total is required');
  return { total, draw: Number(args['budget-draw'] ?? 3), stopShares: { five_hour: stopShare(args, 'stop-session'), seven_day: stopShare(args, 'stop-week') }, chunk: Math.min(Number(args.chunk ?? MAX_CHUNK), MAX_CHUNK) };
}

const REGISTERED = ['baseline', 'candidate', 'ablation', 'large', 'tight'];
function checkRegistration(phase) {
  if (!REGISTERED.includes(phase)) return;
  const problem = preregProblem();
  if (problem) throw new Error(problem);
}

function checkArms(args, phase, stub) {
  const wanted = args.arms ? args.arms.split(',') : null;
  if (wanted?.some((a) => !PHASE_ARMS[phase].includes(a))) throw new Error(`--arms takes ${PHASE_ARMS[phase].join(', ')}`);
  if ((wanted ?? PHASE_ARMS[phase]).includes('somi41') && !args['plugin-41']) throw new Error(`${phase} needs --plugin-41, a packed 4.1 release`);
  if (phase !== 'pilot' && phase !== 'aa' && !stub && (!args['worker-model'] || !isFullModelId(args['worker-model']))) throw new Error('--worker-model is required: the low tier, by its full id');
  if (phase !== 'pilot' && !args['timeout-min']) throw new Error('--timeout-min is required: take it from `bench.mjs plan --pilot DIR`, not from a guess');
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is in the environment; the scorer must run without it');
  return wanted;
}

function openPlan(args, { phase, prereg, wanted, out }) {
  const only = args.tasks ? args.tasks.split(',') : null;
  const plan = buildPlan(phase, tasksFor(phase, only), { seed: Number(args.seed ?? 1), k: args.k ? Number(args.k) : drawsFor(phase, prereg), armK: armKFor(phase, prereg) }).filter((d) => !wanted || wanted.includes(d.arm));
  const planFile = path.join(out, 'plan.json');
  const planText = JSON.stringify({ phase, model: args.model, worker_model: args['worker-model'] ?? null, rule: ruleHash(), host: hostFingerprint(), draws: plan.map((d) => d.id) });
  if (fs.existsSync(planFile) && fs.readFileSync(planFile, 'utf8') !== planText) throw new Error('--out holds a different plan');
  fs.writeFileSync(planFile, planText);
  return plan;
}

// The plugin each arm runs, the eval token's file, the agent binary and the sandbox. The agent runs with bypassed permissions, so the
// sandbox can only be dropped for a stub the caller names.
function drawTools(args, runTmp) {
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
  if (args['no-sandbox'] && !args.claude) throw new Error('--no-sandbox needs --claude, a stub');
  const claude = args.claude ? path.resolve(args.claude) : resolveBinary('claude');
  if (!claude || (!args['no-sandbox'] && resolveBinary('bwrap') === null)) throw new Error('claude and bubblewrap are both required');
  const home = process.env.HOME ?? os.homedir();
  const specFor = (arm) => (args['no-sandbox'] ? null : sandboxSpec({ home, repoRoot: REPO, claudeReal: claude, plugin: pluginOf(arm) }));
  if (!args['no-sandbox'] && !probeSandbox(specFor('bare'))) throw new Error('bubblewrap is not usable here');
  return { pluginOf, env, claude, specFor };
}

// Why the recording stops before the next draw, or null.
async function stopBefore(st, cfg) {
  const { budget, args } = cfg;
  if (st.spent + budget.draw > budget.total) return { stop: 'budget', say: `budget stop: spent $${st.spent.toFixed(2)} of $${budget.total}` };
  const near = hostStop(st.session.hostWindows, Date.now(), budget.stopShares);
  if (near) return { stop: near.name === 'seven_day' ? 'week' : 'window', say: `host window stop: ${near.name} is at ${Math.round(near.share * 100)}% or more; resets=${near.resetsAt}` };
  const windowTokens = Number(args['window-tokens']);
  if (windowTokens > 0 && st.session.windowWeighted >= windowTokens * WINDOW_STOP_SHARE) return { stop: 'window', say: 'window stop: this session used 60% of the stated window; run it again in the next window' };
  if (!cfg.stub && !await waitForQuiet(Number(args['quiet-wait-min'] ?? QUIET_WAIT_MIN), () => st.interrupted)) return { stop: 'quiet', say: 'quiet stop: the machine stayed busy, so this chunk ends here; run it again later' };
  return null;
}

function measure(st, result, drawDir) {
  const usage = streamUsage(path.join(drawDir, 'stream.jsonl'));
  const measured = { cost: result.cost, wall_ms: result.wallMs ?? 0, turns: usage.turns, tokens: usage.tokens, weighted: weightedTokens(usage.tokens), models: usage.models, spend: usage.spend, compactions: usage.compactions };
  st.spent += measured.cost;
  st.session.windowWeighted += measured.weighted;
  st.session.hostWindows = hostWindows(path.join(drawDir, 'stream.jsonl')) ?? st.session.hostWindows;
  st.ran++;
  return measured;
}

function appendRow(st, cfg, row) {
  fs.appendFileSync(cfg.resultsFile, `${JSON.stringify(row)}\n`);
  st.rows.push(row);
}

const HALTS = /^(account-limit|bg-wait-ceiling|auth|spawn-error|no-result)/;

// A halt the recording cannot score. An account limit on an arm that has hit it often enough abandons that arm and carries on.
function halted(st, cfg, { d, cls, measured }) {
  const row = scoreRow(d, { halted: cls.reason.split(':')[0], ...measured });
  appendRow(st, cfg, row);
  console.log(`halted ${d.id}: ${row.halted}`);
  return row.halted !== 'account-limit' || !abandonedArms(st.rows).has(d.arm) ? row.halted : null;
}

// One draw. Returns why the recording stops, or null to carry on.
async function oneDraw(st, cfg, d, load) {
  const dir = path.join(REPO, d.dir);
  const t = admittedTask(st, d, dir);
  const drawDir = path.join(cfg.out, d.id);
  fs.mkdirSync(drawDir, { recursive: true, mode: 0o700 });
  // A draw lost to a stop runs again, and its stream is appended to, so what it spent would count twice.
  fs.rmSync(path.join(drawDir, 'stream.jsonl'), { force: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-v2-draw-'));
  console.log(`start ${d.id}`);
  try {
    const { ws, before } = prepareDraw(cfg, d, { dir, tmp });
    const result = await runDraw(drawRequest(st, cfg, d, { t, dir, tmp, ws, drawDir }));
    if (st.interrupted) return 'interrupted';
    const after = lstatManifest(ws);
    // Measured before anything is copied in to score the draw, so only the draw's own work is judged.
    const quality = await scoreQuality(ws);
    result.leaks = [...new Set([...result.leaks, ...inspectDraw({ ws, cfg: path.join(tmp, 'cfg'), after, drawDir, token: cfg.env.token, canary: t.task.canary, absAb: path.dirname(dir) })])];
    const cls = classify({ run: result, arm: engineArm(d.arm), budget: cfg.budget.draw });
    const measured = measure(st, result, drawDir);
    if (cls.outcome === 'invalid' && HALTS.test(cls.reason)) return halted(st, cfg, { d, cls, measured });
    const { row, solved, halt, pinned } = scoreDraw(cfg, { d, t, dir, ws, before, after, result, cls, measured, drawDir, load });
    row.quality = quality;
    appendRow(st, cfg, row);
    console.log(`done ${d.id}: ${solved ? 'solved' : 'not solved'}, $${measured.cost.toFixed(3)}`);
    if (halt) throw new Error(halt);
    if (!pinned) throw new Error(`${d.id}: served ${measured.models.join(', ')}, not the pinned model`);
    return null;
  } finally { removeTree(tmp); }
}

async function drawAll(st, cfg, plan, finished) {
  for (const d of plan.filter((x) => !finished.has(x.id))) {
    if (abandonedArms(st.rows).has(d.arm)) { appendRow(st, cfg, scoreRow(d, { outcome: 'no-valid-score', solved: false, abandoned: true, weighted: 0, cost: 0, wall_ms: 0, turns: 0 })); continue; }
    if (st.interrupted || st.ran >= cfg.budget.chunk) return;
    const stopped = await stopBefore(st, cfg);
    if (stopped) { st.stop = stopped.stop; console.log(stopped.say); return; }
    st.stop = await oneDraw(st, cfg, d, Number(os.loadavg()[0].toFixed(1)));
    if (st.stop) return;
  }
}

export async function run(args, session = { windowWeighted: 0 }) {
  const phase = args.phase;
  const prereg = readJson(PREREG);
  const stub = Boolean(args.claude);
  checkModels(args, stub);
  checkScope(args, phase, stub);
  const budget = budgets(args);
  checkRegistration(phase);
  const wanted = checkArms(args, phase, stub);
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const plan = openPlan(args, { phase, prereg, wanted, out });
  const done = readResults(out);
  const finished = new Set(done.filter((r) => !r.halted).map((r) => r.draw));
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-v2-'));
  process.on('exit', () => removeTree(runTmp));
  const cfg = { args, phase, stub, budget, out, resultsFile: path.join(out, 'results.jsonl'), pins: [args.model, ...(args['worker-model'] ? [args['worker-model']] : [])], ...drawTools(args, runTmp) };
  const st = { session, rows: [...done], spent: done.reduce((s, r) => s + (r.cost ?? 0), 0), ran: 0, stop: null, interrupted: false, admitted: new Map(), kills: new Set() };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { st.interrupted = true; st.kills.forEach((k) => k()); });
  const left = plan.filter((d) => !finished.has(d.id)).length;
  console.log(`worst case: ${left} draws at $${budget.draw} each is $${(left * budget.draw).toFixed(2)}, capped by the total of $${budget.total}`);
  await drawAll(st, cfg, plan, finished);
  const remaining = plan.length - st.rows.filter((r) => !r.halted).length;
  console.log(`this chunk ran ${st.ran} draws; ${remaining} remain`);
  return { ran: st.ran, remaining, stop: st.stop };
}

// One command: chunks to the end of the plan or to a stop, then the record. A stop leaves the draws in place, and running it again resumes.
export async function record(args) {
  const session = { windowWeighted: 0 };
  for (;;) {
    const r = await run(args, session);
    if (r.stop) { console.log(`stopped: ${r.stop}. Run the same command again to resume.`); return 1; }
    if (r.remaining === 0 || r.ran === 0) break;
  }
  return writeRecord(path.resolve(args.out), args.write ?? path.join(HERE, 'records')) ? 0 : 1;
}
