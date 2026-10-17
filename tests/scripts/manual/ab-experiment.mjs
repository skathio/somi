#!/usr/bin/env node
// Manual driver for the SoMi-vs-bare experiment: runs every task once per arm (plus noise draws on the bare arm) with the
// real claude CLI inside a bubblewrap sandbox, scores each workspace with the frozen hidden suite, appends one JSON line per
// draw to results.jsonl and prints the report. It spends real credits and is NEVER run by npm test or shipped (tests/.npmignore
// excludes manual/).
//
//   node tests/scripts/manual/ab-experiment.mjs --model ALIAS [--tasks a,b] [--out DIR] [--concurrency 3]
//     [--budget-per-draw 8] [--budget-somi USD] [--budget-total 130] [--timeout-min 40] [--timeout-somi-min MIN] [--seed 1] [--noise T1-proration:2] [--only task:arm,..]
//     [--claude claude] [--env-file .somi/eval.env] [--sandbox auto|off] [--unsafe-no-sandbox] [--plugin-dir DIR] [--token-fd]
//     [--ceiling-somi low|medium|high] [--pin-all] [--dry-run] [--force-budget] [--report-only results.jsonl]
//
//   --budget-somi, --timeout-somi-min  the SoMi arm's own dollar cap and time limit (default: the --budget-per-draw and --timeout-min
//                 values). The bare arm always uses --budget-per-draw and --timeout-min. The plan, the worst case, the budget-total
//                 check, the resume budget and the deadline all use the arm's own values. The spend in the log lines is the running
//                 total over all finished draws of the run, not the cost of the draw named on the line.
//   --ceiling-somi  the tier written as cost.ceiling into every workspace's .somi/config.json (default medium). The bare arm has
//                 no plugin, so the file is inert there; it is written identically so the two workspaces differ only where the
//                 experiment differs. Checked by the plugin's own validator (scripts/lib/cost-config.mjs).
//   --pin-all     also writes cost.agents, pinning EVERY agent to the --ceiling-somi tier. The names are the agents/*.md file
//                 names of the plugin directory in use (--plugin-dir, else this repository, which is what is packed). The driver
//                 knows no model names: the tier maps to a model through the plugin's cost.mapping, so choose --model to match.
//   --concurrency draws run in parallel and share the account's usage window; so does any other Claude activity on the same account.
//                 A call cut off by the window ends the run (reason account-limit): re-run after the reset time in the report.
//   --model       required; the model name is never defaulted in code.
//   --sandbox     auto (default): bubblewrap must work or the run is refused, unless --unsafe-no-sandbox. off: no sandbox; allowed
//                 for a stub --claude, refused for the real one without --unsafe-no-sandbox.
//   The web tools (WebFetch, WebSearch) are disabled for both arms, but the sandbox shares the network: a shell can still reach it.
//   --plugin-dir  an already extracted package to use as the SoMi arm's plugin (default: npm pack of this repository, extracted
//                 read-only into a run temp directory). Refused if it holds tests/evals or .somi.
//   --token-fd    hand the token to the CLI through a pipe (CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3) instead of the environment.
//                 Off by default: the installed binary names this variable, but its behaviour is not verified.
//   The per-draw timeout is the hard bound on time and covers all resumes of a draw. --max-budget-usd is the CLI's own cap; one
//   call can overshoot it, and a draw that ends without a result is charged its whole cap.
//
// The draw order is a seeded shuffle of all draws (mulberry32). The order index in each row is the run order the pre-registered
// rule reads. Before each draw the cumulative spend plus the cap of every draw in flight plus this draw's own cap must fit the total
// budget, otherwise the remaining draws are recorded as budget-stop. A scorer fault, a changed task or a tampered harness HALTS the
// run. The token is read once into a local variable, handed to the child and the stream sink only, and is in no row, log line or
// kept file. Workspaces live under the OS temp directory and are kept for inspection; remove them by path.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitTask } from '../../evals/lib/admit.mjs';
import { scoreHidden } from '../../evals/lib/score-hidden.mjs';
import { lstatManifest, scopeVerdict } from '../../evals/lib/manifest.mjs';
import { declaredScope, taskHash } from '../../evals/lib/task-store.mjs';
import { armPrompt, buildPlugin, childEnv, classify, foldScore, prepareWorkspace, probeSandbox, readEnvFile, resolveBinary, runDraw, sandboxSpec, seededShuffle, taskText } from '../../evals/lib/ab-draw.mjs';
import { inspectDraw } from '../../evals/lib/ab-stream.mjs';
import { buildReport } from '../../evals/lib/ab-report.mjs';
import { VALID_COSTS } from '../../../scripts/lib/cost-model.mjs';
import { validateCostConfig } from '../../../scripts/lib/cost-config.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const AB = path.join(REPO, 'tests/evals/ab');
const FLAGS = new Set(['tasks', 'out', 'concurrency', 'budget-per-draw', 'budget-total', 'timeout-min', 'seed', 'noise', 'only', 'claude', 'env-file', 'report-only', 'model', 'sandbox', 'plugin-dir', 'budget-somi', 'timeout-somi-min', 'ceiling-somi']);
const SWITCHES = new Set(['dry-run', 'force-budget', 'unsafe-no-sandbox', 'token-fd', 'pin-all']);
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
const kills = new Set();
const killAll = () => { for (const k of [...kills]) k(); };
const die = (msg, code = 2) => { killAll(); process.stderr.write(`ab-experiment: ${msg}\n`); process.exit(code); };
process.on('exit', killAll);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || (!FLAGS.has(k) && !SWITCHES.has(k))) die(`unknown argument ${JSON.stringify(argv[i].slice(0, 40))}`);
    if (SWITCHES.has(k)) a[k] = true;
    else if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) die(`--${k} needs a value`);
    else a[k] = argv[++i];
  }
  const num = (k, d, min) => { const v = a[k] === undefined ? d : Number(a[k]); if (!Number.isFinite(v) || v < min) die(`--${k} must be a number >= ${min}`); return v; };
  if (a.sandbox !== undefined && !['auto', 'off'].includes(a.sandbox)) die('--sandbox must be auto or off');
  if (a['ceiling-somi'] !== undefined && !VALID_COSTS.includes(a['ceiling-somi'])) die(`--ceiling-somi must be one of ${VALID_COSTS.join('|')}`);
  return { ...a, concurrency: Math.floor(num('concurrency', 3, 1)), budgetPerDraw: num('budget-per-draw', 8, 0.1), budgetTotal: num('budget-total', 130, 0.1), timeoutMin: num('timeout-min', 40, 0.001), budgetSomi: num('budget-somi', a['budget-per-draw'] === undefined ? 8 : Number(a['budget-per-draw']), 0.1), timeoutSomiMin: num('timeout-somi-min', a['timeout-min'] === undefined ? 40 : Number(a['timeout-min']), 0.001), seed: Math.floor(num('seed', 1, 0)), ceilingSomi: a['ceiling-somi'] ?? 'medium', pinAll: a['pin-all'] === true };
}

/** The `cost` block both arms' workspaces carry: `ceiling`, plus with `pinAll` every agent in `agentsDir` pinned to it. The
 *  shared validator decides what is legal (tier, agent names); it throws a `cost-ceiling:` Error otherwise. */
function costBlock({ ceiling, pinAll, agentsDir }) {
  const cost = { ceiling };
  if (pinAll) {
    const names = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
    if (names.length === 0) throw new Error(`no agents found under ${agentsDir}`);
    cost.agents = Object.fromEntries(names.map((n) => [n, ceiling]));
  }
  validateCostConfig(cost);
  if (!VALID_COSTS.includes(ceiling)) throw new Error(`cost-ceiling: ceiling expected one of ${VALID_COSTS.join('|')}`);
  return cost;
}

const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
function unlock(dir) { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) { fs.chmodSync(path.join(dir, e.name), 0o700); unlock(path.join(dir, e.name)); } } fs.chmodSync(dir, 0o700); } catch { /* gone */ } }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args['report-only']) { console.log(buildReport(readRows(args['report-only']))); return 0; }
  if (typeof args.model !== 'string' || !MODEL.test(args.model)) die('--model <alias> is required (letters, digits and . _ : [ ] -, starting with a letter or digit)');
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) die('CLAUDE_CODE_OAUTH_TOKEN is already in the environment; the scorer must run without it (the driver reads the env file itself)');

  const taskNames = args.tasks ? args.tasks.split(',') : fs.readdirSync(AB, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (taskNames.length === 0 || new Set(taskNames).size !== taskNames.length) die('--tasks must name each task once');
  if (taskNames.some((t) => !NAME.test(t) || !fs.existsSync(path.join(AB, t, 'task.json')))) die('--tasks names a directory under tests/evals/ab that has no task.json');
  const noiseSpec = args.noise ?? (args.only || args.tasks ? '' : 'T1-proration:2');
  const capOf = (arm) => (arm === 'somi' ? args.budgetSomi : args.budgetPerDraw);
  const minutesOf = (arm) => (arm === 'somi' ? args.timeoutSomiMin : args.timeoutMin);
  const noise = noiseSpec === '' ? [] : noiseSpec.split(',').map((s) => { const [task, n] = s.split(':'); return { task, n: Number(n) }; });
  if (noise.some((x) => !taskNames.includes(x.task) || !Number.isInteger(x.n) || x.n < 0 || x.n > 10)) die('--noise must be task:count with a selected task and a count of 0 to 10');

  let draws = [];
  for (const task of taskNames) for (const arm of ['bare', 'somi']) draws.push({ id: `${task}-${arm}`, task, arm, noise: false });
  for (const { task, n } of noise) for (let i = 1; i <= n; i++) draws.push({ id: `${task}-bare-noise${i}`, task, arm: 'bare', noise: true });
  if (args.only) {
    const want = args.only.split(',');
    if (want.some((w) => !draws.some((d) => !d.noise && `${d.task}:${d.arm}` === w))) die('--only entries must be task:arm of a selected task');
    draws = draws.filter((d) => d.noise || want.includes(`${d.task}:${d.arm}`));
  }
  draws = seededShuffle(draws, args.seed).map((d, order) => ({ ...d, order }));
  const worst = draws.reduce((sum, d) => sum + capOf(d.arm), 0);
  console.log(`plan: ${draws.length} draw(s) over ${taskNames.length} task(s), model ${args.model}, seed ${args.seed}, concurrency ${args.concurrency}`);
  console.log(`worst case: ${draws.filter((d) => d.arm === 'bare').length} bare x $${args.budgetPerDraw} + ${draws.filter((d) => d.arm === 'somi').length} SoMi x $${args.budgetSomi} = $${worst.toFixed(2)} against a total budget of $${args.budgetTotal}`);
  console.log(`time: each bare draw gets ${args.timeoutMin} min and each SoMi draw ${args.timeoutSomiMin} min for all their turns (the hard bound); a single call can overshoot its dollar cap, and a draw ending without a result is charged the whole cap`);
  for (const d of draws) console.log(`  ${String(d.order).padStart(2)} ${d.id} (cap $${capOf(d.arm)}, ${minutesOf(d.arm)} min)`);
  if (worst > args.budgetTotal && !args['force-budget']) die(`the worst case $${worst.toFixed(2)} exceeds --budget-total $${args.budgetTotal}; lower --budget-per-draw or pass --force-budget`);

  // Admission up front: a task that is not admitted costs nothing, and its name list is what every draw is scored against.
  const tasks = new Map();
  for (const name of taskNames) {
    const dir = path.join(AB, name);
    const adm = admitTask(dir, { repeats: 1 });
    const th = taskHash(dir);
    if (!adm.ok || !th.ok || th.hash !== adm.hash) die(`task ${name} is not admitted: ${adm.ok ? 'hash mismatch' : adm.reason}`, 1);
    tasks.set(name, { dir, task: th.task, hash: adm.hash, expect: { total: adm.total, names: adm.names } });
  }

  // The pinned names come from the plugin directory actually used: --plugin-dir, else this repository (what npm pack packs).
  const agentsDirOf = (pluginDir) => path.join(pluginDir ?? (args['plugin-dir'] ? path.resolve(args['plugin-dir']) : REPO), 'agents');
  const costFor = (pluginDir) => { try { return costBlock({ ceiling: args.ceilingSomi, pinAll: args.pinAll, agentsDir: agentsDirOf(pluginDir) }); } catch (e) { return die(`the cost config is not valid: ${String(e?.message ?? e).slice(0, 160)}`); } };
  const costLine = (cost) => `cost config (both arms, same content): ceiling ${cost.ceiling}, pin-all ${args.pinAll ? `on (${Object.keys(cost.agents).length} agents pinned to ${cost.ceiling})` : 'off (0 agents pinned)'}`;

  if (args['dry-run']) {
    const cost = costFor(null);
    console.log(costLine(cost));
    for (const d of draws) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-draw-'));
      try { const { ws, before } = prepareWorkspace({ taskDir: tasks.get(d.task).dir, tmp, cost }); console.log(`prepared ${d.id}: ${before.files.length} file(s) in ${ws}`); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    console.log(`dry run: no claude call was made; sandbox ${args.sandbox ?? 'auto'}`);
    return 0;
  }

  const env = readEnvFile(path.resolve(args['env-file'] ?? path.join(REPO, '.somi/eval.env')));
  if (!env.ok) die(env.reason);
  const token = env.token;
  const out = path.resolve(args.out ?? path.join(REPO, '.somi/ab-results', new Date().toISOString().replace(/[:.]/g, '-')));
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) die(`--out ${out} is not empty`);
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-run-'));
  process.on('exit', () => { unlock(runTmp); fs.rmSync(runTmp, { recursive: true, force: true }); });

  const claudeReal = resolveBinary(args.claude ?? 'claude') ?? (args.claude ?? 'claude');
  const sandboxMode = args.sandbox ?? 'auto';
  if (sandboxMode === 'off' && args.claude === undefined && !args['unsafe-no-sandbox']) die('--sandbox off with the real claude needs --unsafe-no-sandbox');
  let plugin = null;
  if (draws.some((d) => d.arm === 'somi')) {
    if (args['plugin-dir']) {
      plugin = path.resolve(args['plugin-dir']);
      if (!fs.statSync(plugin, { throwIfNoEntry: false })?.isDirectory() || fs.existsSync(path.join(plugin, 'tests/evals')) || fs.existsSync(path.join(plugin, '.somi'))) die('--plugin-dir must be a directory without tests/evals and .somi');
    } else { try { plugin = buildPlugin({ repoRoot: REPO, runTmp }); } catch (e) { die(`the plugin could not be packed: ${e.message}`, 1); } }
  }
  const cost = costFor(plugin);
  console.log(costLine(cost));
  const specFor = (arm) => sandboxSpec({ home: process.env.HOME ?? os.homedir(), repoRoot: REPO, claudeReal, plugin: arm === 'somi' ? plugin : null });
  let sandboxOn = false;
  if (sandboxMode === 'auto') {
    sandboxOn = resolveBinary('bwrap') !== null && probeSandbox(specFor('somi')) && probeSandbox(specFor('bare'));
    if (!sandboxOn && !args['unsafe-no-sandbox']) die('bubblewrap is not usable here; install it, or pass --unsafe-no-sandbox to accept running the agent with full host access');
  }
  console.log(sandboxOn ? 'sandbox: bubblewrap (repository, real HOME and /tmp hidden; network shared)' : 'WARNING sandbox: none, the agent runs with the maintainer privileges on this host');

  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const resultsFile = path.join(out, 'results.jsonl');
  const claude = sandboxOn ? claudeReal : (args.claude ?? 'claude');
  const st = { spent: 0, reserved: 0, halt: null, stopReason: null, interrupted: false };

  async function doDraw(d) {
    const t = tasks.get(d.task);
    const drawDir = path.join(out, d.id);
    fs.mkdirSync(drawDir, { recursive: true, mode: 0o700 });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-draw-'));
    const row = { draw: d.id, task: d.task, arm: d.arm, noise: d.noise, order: d.order, ceilingSomi: args.ceilingSomi, pinAll: args.pinAll, outcome: 'invalid', reason: '', green: 0, total: t.expect.total, failedNames: [], scope: { ok: false, reason: 'not checked' }, costUsd: 0, durationMs: 0, resumes: 0, turns: 0, models: [], flags: {}, tmp };
    console.log(`start ${d.id}`);
    try {
      const { ws, before } = prepareWorkspace({ taskDir: t.dir, tmp, cost });
      const run = await runDraw({ model: args.model, arm: d.arm, prompt: armPrompt(d.arm, taskText(t.task)), budget: capOf(d.arm), timeoutMs: minutesOf(d.arm) * 60000, claude, env: childEnv({ token, tmp, tokenFd: args['token-fd'] }), cwd: ws, plugin, drawDir, token, tokenFd: args['token-fd'], canary: t.task.canary, task: d.task, absAb: AB, ownTmp: tmp, sandbox: sandboxOn ? specFor(d.arm) : null, kills });
      fs.writeFileSync(path.join(drawDir, 'stderr.txt'), run.stderr, { mode: 0o600 });
      const after = lstatManifest(ws);
      run.leaks = [...new Set([...run.leaks, ...inspectDraw({ ws, cfg: path.join(tmp, 'cfg'), after, drawDir, token, canary: t.task.canary, absAb: AB })])].sort();
      Object.assign(row, classify({ run, arm: d.arm, budget: capOf(d.arm) }), { costUsd: run.cost, durationMs: run.wallMs, resumes: run.resumes, turns: run.turns, models: run.models });
      if (row.reason === 'account-limit') row.resetText = run.reset;
      if (row.reason === 'account-limit' || row.reason === 'bg-wait-ceiling') { st.stopReason = row.reason; st.halt = `${d.id}: ${row.reason}${run.reset ? `, resets ${run.reset}` : ''}`; }
      if (!run.result && !run.error) Object.assign(row, { costUsd: capOf(d.arm), costEstimated: true });
      if (st.interrupted) Object.assign(row, { outcome: 'invalid', reason: 'interrupted' });
      const sv = scopeVerdict({ before, after, declared: declaredScope(t.task) });
      row.scope = sv ? { ok: sv.verdict === 'in-scope', reason: sv.reason } : { ok: false, reason: 'the scope check refused its arguments' };
      const halt = foldScore(row, scoreHidden({ workspace: ws, hiddenDir: path.join(t.dir, 'hidden'), expect: t.expect, taskDir: t.dir, admittedHash: t.hash }));
      if (halt) st.halt = halt;
    } catch (e) { row.reason = `draw-fault: ${String(e?.message ?? e).slice(0, 120)}`; }
    return row;
  }

  const queue = [...draws];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      let row;
      if (st.halt || st.interrupted || st.spent + st.reserved + capOf(d.arm) > args.budgetTotal) {
        row = { draw: d.id, task: d.task, arm: d.arm, noise: d.noise, order: d.order, ceilingSomi: args.ceilingSomi, pinAll: args.pinAll, outcome: 'budget-stop', reason: st.stopReason ?? (st.halt ? 'halted' : st.interrupted ? 'interrupted' : 'budget'), green: 0, total: 0 };
      } else {
        st.reserved += capOf(d.arm);
        row = await doDraw(d);
        st.reserved -= capOf(d.arm); st.spent += row.costUsd;
      }
      fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`, { mode: 0o600 });
      console.log(`done ${row.draw}: ${row.outcome}${row.reason ? ` (${row.reason})` : ''} ${row.green}/${row.total} $${(row.costUsd ?? 0).toFixed(2)} spent $${st.spent.toFixed(2)}`);
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { st.interrupted = true; killAll(); });
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  const report = buildReport(readRows(resultsFile));
  fs.writeFileSync(path.join(out, 'report.txt'), `${report}\n`, { mode: 0o600 });
  console.log(`\n${report}\nresults: ${resultsFile}`);
  if (st.halt) { process.stderr.write(`ab-experiment: HALTED, ${st.halt}\n`); return 1; }
  return st.interrupted ? 130 : 0;
}

main().then((c) => process.exit(c), (e) => die(`unexpected failure: ${String(e?.message ?? e).slice(0, 200)}`, 1));
