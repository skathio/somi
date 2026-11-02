#!/usr/bin/env node
// bench.mjs: benchmark v2. It answers one question: does the 5.0 default lane stay as good as a bare agent, at no more than 1.5x the
// tokens per solved task? See docs/BENCHMARK.md for the routine. A paid run needs --go. Nothing here runs in `npm test`.
//
//   bench.mjs plan   --phase pilot|aa|main|confirm [--model M] [--seed N]             prints the draws, spends nothing
//   bench.mjs run    --phase ... --out DIR --model M --go --budget-total USD [--chunk 24] [--budget-draw USD] [--window-tokens N]
//                    [--plugin-41 DIR] [--env-file FILE] [--timeout-min 40] [--quiet-wait-min 90]
//                    [--claude PATH --no-sandbox]   a stub agent, for proving the harness without spending anything
//   bench.mjs select --pilot DIR [--allow-short]                                      writes task-set.json from a pilot
//   bench.mjs prereg                                                                  binds task-set.json into prereg.json
//   bench.mjs report --out DIR                                                        prints each arm's figures
//   bench.mjs decide --aa DIR --main DIR                                              the release rule; exit 0 only when it ships

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { admitTask } from '../../tests/evals/lib/admit.mjs';
import { buildPlugin, childEnv, classify, foldScore, prepareWorkspace, probeSandbox, readEnvFile, resolveBinary, runDraw, sandboxSpec, seededShuffle, taskText } from '../../tests/evals/lib/ab-draw.mjs';
import { inspectDraw } from '../../tests/evals/lib/ab-stream.mjs';
import { lstatManifest } from '../../tests/evals/lib/manifest.mjs';
import { scoreHidden } from '../../tests/evals/lib/score-hidden.mjs';
import { taskHash } from '../../tests/evals/lib/task-store.mjs';
import { K_DRAWS, armSummary, evaluateAa, evaluateRelease, selectTasks, weightedTokens } from './stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CANDIDATES = path.join(HERE, 'candidates.json');
const TASK_SET = path.join(HERE, 'task-set.json');
const PREREG = path.join(HERE, 'prereg.json');
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
  main: ['bare', 'somi5', 'somi41'],
  confirm: ['bare'],
});

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export const armPrompt = (arm, text) => (arm === 'somi5' ? `/somi:task ${text}` : arm === 'somi41' ? `/somi:ship-loop ${text}` : text);
const engineArm = (arm) => (arm === 'somi5' || arm === 'somi41' ? 'somi' : 'bare');

function tasksFor(phase) {
  if (phase === 'pilot') return readJson(CANDIDATES).tasks;
  if (!fs.existsSync(TASK_SET)) throw new Error('no task-set.json yet: run the pilot, then select');
  const set = readJson(TASK_SET);
  return phase === 'confirm' ? set.tasks.slice(0, set.hardest ?? 6) : set.tasks;
}

// Every arm of a task runs in the same round, in a seeded order, so drift over a long recording falls on all arms alike.
export function buildPlan(phase, tasks, seed = 1, k = K_DRAWS) {
  const arms = PHASE_ARMS[phase];
  const draws = [];
  for (let draw = 1; draw <= k; draw++) {
    for (const task of seededShuffle(tasks, seed + draw)) {
      for (const arm of seededShuffle(arms, seed + draw * 31)) draws.push({ id: `${task.id}.${arm}.${draw}`, task: task.id, dir: task.dir, arm, draw });
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

// Result events come in runs within one CLI call, where usage is cumulative: the last of a run is the call's total.
export function streamUsage(file) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const models = new Set();
  let turns = 0;
  let pending = null;
  const flush = () => {
    for (const m of Object.values(pending ?? {})) {
      totals.input += m?.inputTokens ?? 0;
      totals.output += m?.outputTokens ?? 0;
      totals.cacheRead += m?.cacheReadInputTokens ?? 0;
      totals.cacheCreation += m?.cacheCreationInputTokens ?? 0;
    }
    pending = null;
  };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { tokens: totals, models: [], turns }; }
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    if (ev?.type === 'result') {
      turns += Number.isFinite(ev.num_turns) ? ev.num_turns : 0;
      if (ev.modelUsage && typeof ev.modelUsage === 'object') {
        pending = ev.modelUsage;
        Object.keys(ev.modelUsage).forEach((m) => models.add(m));
      }
    } else flush();
  }
  flush();
  return { tokens: totals, models: [...models].sort(), turns };
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

async function run(args) {
  const phase = args.phase;
  if (!args.go) throw new Error('a run spends real usage: pass --go once the maintainer has agreed the budget');
  if (!args.model || !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/.test(args.model)) throw new Error('--model is required');
  if (!args.out) throw new Error('--out is required');
  const budgetTotal = Number(args['budget-total']);
  if (!(budgetTotal > 0)) throw new Error('--budget-total is required');
  const budgetDraw = Number(args['budget-draw'] ?? 3);
  const chunk = Math.min(Number(args.chunk ?? MAX_CHUNK), MAX_CHUNK);
  if (phase === 'main') {
    const problem = preregProblem();
    if (problem) throw new Error(problem);
    if (!args['plugin-41']) throw new Error('main needs --plugin-41, a packed 4.1 release candidate');
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is in the environment; the scorer must run without it');

  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const plan = buildPlan(phase, tasksFor(phase), Number(args.seed ?? 1));
  const resultsFile = path.join(out, 'results.jsonl');
  const planFile = path.join(out, 'plan.json');
  const planText = JSON.stringify({ phase, model: args.model, draws: plan.map((d) => d.id) });
  if (fs.existsSync(planFile) && fs.readFileSync(planFile, 'utf8') !== planText) throw new Error('--out holds a different plan');
  fs.writeFileSync(planFile, planText);

  const done = readResults(out);
  const finished = new Set(done.filter((r) => !r.halted).map((r) => r.draw));
  const home = process.env.HOME ?? os.homedir();
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-v2-'));
  process.on('exit', () => removeTree(runTmp));
  const plugin5 = buildPlugin({ repoRoot: REPO, runTmp });
  const pluginOf = (arm) => (arm === 'somi5' ? plugin5 : arm === 'somi41' ? path.resolve(args['plugin-41']) : null);
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
  let spent = done.reduce((s, r) => s + (r.cost ?? 0), 0);
  let chunkWeighted = 0;
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
    if (spent + budgetDraw > budgetTotal) { console.log(`budget stop: spent $${spent.toFixed(2)} of $${budgetTotal}`); break; }
    const windowTokens = Number(args['window-tokens']);
    if (windowTokens > 0 && chunkWeighted >= windowTokens * WINDOW_STOP_SHARE) { console.log('window stop: this chunk used 60% of the stated window'); break; }

    if (!await waitForQuiet(Number(args['quiet-wait-min'] ?? QUIET_WAIT_MIN), () => interrupted)) { console.log('quiet stop: the machine stayed busy, so this chunk ends here; run it again later'); break; }
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
      const { ws } = prepareWorkspace({ taskDir: dir, tmp });
      const result = await runDraw({
        model: args.model, arm: engineArm(d.arm), prompt: armPrompt(d.arm, taskText(t.task)), budget: budgetDraw, timeoutMs: Number(args['timeout-min'] ?? 40) * 60000,
        claude, env: childEnv({ token: env.token, tmp }), cwd: ws, plugin: pluginOf(d.arm), drawDir, token: env.token, canary: t.task.canary, task: t.task, absAb: path.dirname(dir), ownTmp: tmp, kills, sandbox: specFor(d.arm),
      });
      if (interrupted) break;
      result.leaks = [...new Set([...result.leaks, ...inspectDraw({ ws, cfg: path.join(tmp, 'cfg'), after: lstatManifest(ws), drawDir, token: env.token, canary: t.task.canary, absAb: path.dirname(dir) })])];
      const cls = classify({ run: result, arm: engineArm(d.arm), budget: budgetDraw });
      const usage = streamUsage(path.join(drawDir, 'stream.jsonl'));
      const measured = { cost: result.cost, wall_ms: result.wallMs ?? 0, turns: usage.turns, tokens: usage.tokens, weighted: weightedTokens(usage.tokens), models: usage.models };
      spent += measured.cost;
      chunkWeighted += measured.weighted;
      ran++;
      let row;
      if (cls.outcome === 'invalid' && /^(account-limit|bg-wait-ceiling|auth|spawn-error|no-result)/.test(cls.reason)) {
        row = scoreRow(d, { halted: cls.reason.split(':')[0], ...measured });
        fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
        rows.push(row);
        console.log(`halted ${d.id}: ${row.halted}`);
        if (row.halted !== 'account-limit' || !abandonedArms(rows).has(d.arm)) break;
        continue;
      }
      const scratch = { draw: d.id, outcome: cls.outcome, reason: cls.reason, green: 0 };
      const sc = scoreHidden({ workspace: ws, taskDir: dir, admittedHash: t.hash, expect: t.expect });
      if (!sc.ok) throw new Error(`the scorer failed on ${d.id}: ${sc.reason}`);
      const stop = foldScore(scratch, sc);
      const solved = scratch.outcome === 'scored' && sc.total > 0 && scratch.green === sc.total && !Object.values(scratch.flags ?? {}).some(Boolean);
      row = scoreRow(d, { outcome: scratch.outcome, reason: scratch.reason, green: scratch.green, total: sc.total, solved, failed: (scratch.failedNames ?? []).slice(0, MAX_FAILED_NAMES), flags: scratch.flags, load, ...measured });
      fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      rows.push(row);
      console.log(`done ${d.id}: ${solved ? 'solved' : 'not solved'}, $${measured.cost.toFixed(3)}`);
      if (stop) throw new Error(stop);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  console.log(`this chunk ran ${ran} draws; ${plan.length - rows.filter((r) => !r.halted).length} remain`);
  return 0;
}

const completed = (dir) => readResults(dir).filter((r) => !r.halted).map((r) => ({ ...r, draw: r.k }));

async function main(argv) {
  const [command, ...rest] = argv;
  const { values: args } = parseArgs({
    args: rest,
    options: {
      phase: { type: 'string' }, out: { type: 'string' }, model: { type: 'string' }, seed: { type: 'string' }, go: { type: 'boolean' }, chunk: { type: 'string' },
      'budget-total': { type: 'string' }, 'budget-draw': { type: 'string' }, 'window-tokens': { type: 'string' }, 'plugin-41': { type: 'string' }, 'env-file': { type: 'string' },
      'timeout-min': { type: 'string' }, 'quiet-wait-min': { type: 'string' }, claude: { type: 'string' }, 'no-sandbox': { type: 'boolean' }, pilot: { type: 'string' }, 'allow-short': { type: 'boolean' }, aa: { type: 'string' }, main: { type: 'string' },
    },
  });
  if (command === 'plan' || command === 'run') {
    if (!Object.hasOwn(PHASE_ARMS, args.phase ?? '')) throw new Error('--phase takes pilot, aa, main or confirm');
    if (command === 'run') return run(args);
    const plan = buildPlan(args.phase, tasksFor(args.phase), Number(args.seed ?? 1));
    console.log(`${plan.length} draws across ${new Set(plan.map((d) => d.task)).size} tasks; chunks of at most ${MAX_CHUNK}; no spend`);
    plan.forEach((d) => console.log(`  ${d.id}`));
    return 0;
  }
  if (command === 'select') {
    if (!args.pilot) throw new Error('--pilot is required');
    const picked = selectTasks(completed(args.pilot), readJson(CANDIDATES).tasks);
    console.log(JSON.stringify({ kept: picked.tasks.length, boundary: picked.boundary, shortfalls: picked.shortfalls }));
    if (picked.shortfalls.length > 0 && !args['allow-short']) { console.error('the set falls short; author more tasks, or pass --allow-short to record the shortfall'); return 1; }
    fs.writeFileSync(TASK_SET, `${JSON.stringify({ tasks: picked.tasks, hardest: 6, shortfalls: picked.shortfalls }, null, 2)}\n`);
    return 0;
  }
  if (command === 'prereg') {
    const prereg = readJson(PREREG);
    prereg.task_set_sha256 = sha256(fs.readFileSync(TASK_SET));
    fs.writeFileSync(PREREG, `${JSON.stringify(prereg, null, 2)}\n`);
    console.log(`bound ${prereg.task_set_sha256}; commit prereg.json and task-set.json before the first paid main draw`);
    return 0;
  }
  if (command === 'report') {
    if (!args.out) throw new Error('--out is required');
    const rows = completed(args.out);
    const arms = [...new Set(rows.map((r) => r.arm))].sort();
    console.log(JSON.stringify({ arms: arms.map((a) => armSummary(rows, a)), aa: arms.includes('bare-a') ? evaluateAa(rows) : undefined }, null, 2));
    return 0;
  }
  if (command === 'decide') {
    if (!args.aa || !args.main) throw new Error('--aa and --main are required');
    const verdict = evaluateRelease({ aa: completed(args.aa), main: completed(args.main) });
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.ships ? 0 : 1;
  }
  throw new Error('bench takes plan, run, select, prereg, report or decide');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`bench: ${e.message}`); process.exitCode = 1; });
}
