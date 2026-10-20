#!/usr/bin/env node
// Manual driver for the usage and speed benchmark's live layer (L2): runs a seeded, interleaved plan of draws, ONE at a
// time, two arms (somi, bare) per scenario, with the real claude CLI inside a bubblewrap sandbox, and appends one validated
// line per finished draw to results.jsonl. It spends real credits and is NEVER run by npm test or shipped (tests/.npmignore
// excludes manual/). It computes no verdict: report.txt holds counts, medians and spend; usage-compare.mjs compares two
// baselines built from the rows.
//
//   node tests/scripts/manual/usage-bench.mjs --model ALIAS --phase calibration|sizing|experiment --out DIR
//     [--scenarios S1,S2,S3] [--repeats 8] [--budget-total USD] [--budget-somi 6] [--budget-bare 2] [--budget-probe 0.5]
//     [--timeout-min 40] [--timeout-probe-min 5] [--ceiling-somi low] [--seed 1] [--pinned-ids ID,ID] [--sizing-probe]
//     [--plan-only|--dry-run] [--force-budget] [--claude claude] [--sandbox auto|off] [--unsafe-no-sandbox]
//     [--env-file .somi/eval.env] [--plugin-dir DIR] [--token-fd]
//
// Scenarios (the table is SCENARIOS below; a scenario file can come with the baseline):
//   S1  /code-loop on the committed brief of tests/evals/fixtures/task02-code (slug expired-token). SoMi arm: the
//       code-loop invocation the convergence harness uses, with the plugin namespace added. Bare arm: the
//       fixture author's own spec.md and phase file as the task text. Scored by a 9-test suite built into this file (S1_CASES),
//       run through the same scoreHidden runner as the A/B tasks, after the draw.
//   S2  T1 (tests/evals/ab/T1-proration) through /somi:ship-loop; the bare arm gets the task text. Hidden suite of the task.
//   S3  M01 bracket seeding (tests/evals/ab-micro/M01-bracket-seeding), same arms and scoring as S2.
//   S4-M01, S4-M03, S4-M05, S4-M08  sizing probes (--sizing-probe): SoMi arm only, one call, zero resumes, the draw ends where
//       the sizing step stops, never scored. The row is outcome invalid with reason probe; its stratum is the phase.
//
// Plan and resume: the first run writes plan.json (seed, model, caps, scenarios, rule hash, plugin hash, ordered draws, rounds
// interleave arms and scenarios). A re-run into the same --out recomputes the plan from its flags and refuses on any
// difference; draws with a terminal entry are skipped, a draw whose last entry is halted (account-limit, bg-wait-ceiling, auth,
// budget-stop, harness-fault) is run again, a SIGINT writes nothing for the draw in flight, and a torn results line refuses.
// --out must lie under HOME, the repository or the temp directory, all of which the sandbox hides from the draw.
// The token is read once from the env file, handed to the child and the stream sink only, and is in no row, log line,
// argument or kept file. The pinned set is --model (and --pinned-ids): a model in a draw's stream that is not pinned makes the
// row invalid (reason unpinned-model).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { admitTask } from '../../evals/lib/admit.mjs';
import { scoreHidden } from '../../evals/lib/score-hidden.mjs';
import { lstatManifest } from '../../evals/lib/manifest.mjs';
import { taskHash } from '../../evals/lib/task-store.mjs';
import { armPrompt, buildPlugin, childEnv, classify, foldScore, prepareWorkspace, probeSandbox, readEnvFile, resolveBinary, resolveTier, runDraw, sandboxSpec, taskText } from '../../evals/lib/ab-draw.mjs';
import { inspectDraw, redactToken } from '../../evals/lib/ab-stream.mjs';
import { loadRule } from '../../evals/lib/bench-rule.mjs';
import { buildBenchReport, buildPlan, parseResults, parseStream, pendingDraws, planMismatch, spentUsd, toRow } from '../../evals/lib/bench-usage.mjs';
import { VALID_COSTS } from '../../../scripts/lib/cost-model.mjs';
import { validateCostConfig } from '../../../scripts/lib/cost-config.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const FLAGS = new Set(['model', 'scenarios', 'repeats', 'phase', 'out', 'budget-total', 'budget-somi', 'budget-bare', 'budget-probe', 'timeout-min', 'timeout-probe-min', 'ceiling-somi', 'seed', 'pinned-ids', 'claude', 'sandbox', 'env-file', 'plugin-dir']);
const SWITCHES = new Set(['sizing-probe', 'plan-only', 'dry-run', 'force-budget', 'unsafe-no-sandbox', 'token-fd']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_RESULTS_BYTES = 64 * 1024 * 1024;
const HALTING = ['account-limit', 'bg-wait-ceiling', 'auth', 'no-result'];
const kills = new Set();
const killAll = () => { for (const k of [...kills]) k(); };
const die = (msg, code = 2) => { killAll(); process.stderr.write(`usage-bench: ${msg}\n`); process.exit(code); };
process.on('exit', killAll);

// ---- scenarios -------------------------------------------------------------------------------------------------

const FIXTURE = 'tests/evals/fixtures/task02-code';
const PROBES = { 'S4-M01': 'M01-bracket-seeding', 'S4-M03': 'M03-rank-aggregation', 'S4-M05': 'M05-round-robin', 'S4-M08': 'M08-line-breaks' };
const SCENARIOS = {
  S1: { kind: 'fixture', slug: 'expired-token', iteration: '1.1' },
  S2: { kind: 'task', corpus: 'tests/evals/ab', task: 'T1-proration' },
  S3: { kind: 'task', corpus: 'tests/evals/ab-micro', task: 'M01-bracket-seeding' },
  ...Object.fromEntries(Object.entries(PROBES).map(([id, task]) => [id, { kind: 'task', corpus: 'tests/evals/ab-micro', task, probe: true }])),
};
// S1 hidden checks: [name, expression]. `T` is the candidate's src/auth/token.mjs, `S` its session.mjs, `now` epoch seconds,
// `throws(f)` true when f throws. Each runs in a child process (probe.mjs) that prints a nonce-tagged verdict.
const S1_CASES = [
  ['rejects an expired token', 'throws(() => T.verifyToken(T.mintToken("u", now - 3600)))'],
  ['rejects a token that expired one second ago', 'throws(() => T.verifyToken(T.mintToken("u", now - 1)))'],
  ['accepts a valid token and returns its subject', 'T.verifyToken(T.mintToken("user-1", now + 3600)).sub === "user-1"'],
  ['[regression] rejects a tampered signature', 'throws(() => T.verifyToken(T.mintToken("u", now + 3600).split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))'],
  ['[regression] rejects malformed input', 'throws(() => T.verifyToken("not-a-token")) && throws(() => T.verifyToken(""))'],
  ['the export surface is unchanged', 'Object.keys(T).sort().join() === "mintToken,verifyToken"'],
  ['a token without exp is treated as before', 'T.verifyToken(T.mintToken("u", undefined)).sub === "u"'],
  ['a second parameter, when honoured, is a clock in epoch milliseconds', '(() => { const t = T.mintToken("u", now + 60); return !throws(() => T.verifyToken(t, (now + 120) * 1000)) || !throws(() => T.verifyToken(t, (now - 120) * 1000)); })()'],
  ['loadSession still loads a valid session', 'S.loadSession(T.mintToken("s", now + 3600)).sub === "s"'],
];
const S1_PROBE = `import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [nonce, index] = process.argv.slice(2);
const root = process.env.TASK_WORKSPACE;
const load = (f) => import(pathToFileURL(path.join(root, f)).href).catch(() => null);
const T = await load('src/auth/token.mjs'); const S = await load('src/auth/session.mjs');
const now = Math.floor(Date.now() / 1000);
const throws = (f) => { try { f(); return false; } catch { return true; } };
const cases = [${S1_CASES.map(([, e]) => `() => ${e}`).join(',\n')}];
let ok = false; try { ok = T !== null && cases[Number(index)]() === true; } catch { ok = false; }
process.stdout.write('\\nC:' + nonce + ':' + JSON.stringify({ ok }) + '\\n');
`;
const S1_TESTS = `import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
const nonce = randomUUID();
const names = ${JSON.stringify(S1_CASES.map(([n]) => n))};
const run = (i) => {
  const r = spawnSync(process.execPath, [new URL('./probe.mjs', import.meta.url).pathname, nonce, String(i)], { env: process.env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1 << 20 });
  const part = ('\\n' + (r.stdout ?? '')).split('\\nC:' + nonce + ':')[1];
  try { return r.status === 0 && JSON.parse(part.split('\\n')[0]).ok === true; } catch { return false; }
};
names.forEach((n, i) => test(n, () => assert.ok(run(i), 'check failed')));
`;
function scoreS1(ws) {
  const hid = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-s1-'));
  try {
    fs.writeFileSync(path.join(hid, 's1.test.mjs'), S1_TESTS);
    fs.writeFileSync(path.join(hid, 'probe.mjs'), S1_PROBE);
    return scoreHidden({ workspace: ws, hiddenDir: hid, expect: { total: S1_CASES.length, names: S1_CASES.map(([n]) => n) } });
  } finally { fs.rmSync(hid, { recursive: true, force: true }); }
}

// ---- arguments, cost block, guards ------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || (!FLAGS.has(k) && !SWITCHES.has(k))) die(`unknown argument ${JSON.stringify(argv[i].slice(0, 40))}`);
    if (SWITCHES.has(k)) a[k] = true;
    else if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) die(`--${k} needs a value`);
    else a[k] = argv[++i];
  }
  const num = (k, d, min, int = false) => { const v = a[k] === undefined ? d : Number(a[k]); if (!Number.isFinite(v) || v < min || (int && !Number.isInteger(v))) die(`--${k} must be ${int ? 'an integer' : 'a number'} >= ${min}`); return v; };
  if (!['calibration', 'sizing', 'experiment'].includes(a.phase)) die('--phase calibration, sizing or experiment is required (rows of different phases never share an --out)');
  if (a['sandbox'] !== undefined && !['auto', 'off'].includes(a.sandbox)) die('--sandbox must be auto or off');
  if (a['ceiling-somi'] !== undefined && !VALID_COSTS.includes(a['ceiling-somi'])) die(`--ceiling-somi must be one of ${VALID_COSTS.join('|')}`);
  const probe = a['sizing-probe'] === true;
  if (probe && a.phase === 'experiment') die('--sizing-probe cannot run in the experiment phase (a probe is never an experiment draw)');
  if (!probe && a.phase === 'sizing') die('the sizing phase is for --sizing-probe draws only');
  const dry = a['plan-only'] === true || a['dry-run'] === true;
  if (!dry && (a.out === undefined || a['budget-total'] === undefined)) die('--out and --budget-total are required (neither is defaulted)');
  const scenarios = (a.scenarios ?? (probe ? Object.keys(PROBES).join(',') : 'S1,S2,S3')).split(',');
  if (new Set(scenarios).size !== scenarios.length || scenarios.some((s) => !Object.hasOwn(SCENARIOS, s) || Boolean(SCENARIOS[s].probe) !== probe)) die(`--scenarios must name each of ${Object.keys(SCENARIOS).filter((s) => Boolean(SCENARIOS[s].probe) === probe).join(', ')} at most once${probe ? '' : ' (probes need --sizing-probe)'}`);
  const pinnedExtra = a['pinned-ids'] === undefined ? [] : [...new Set(a['pinned-ids'].split(','))].sort();
  if (pinnedExtra.some((m) => !MODEL.test(m))) die('--pinned-ids must list model ids (letters, digits and . _ : [ ] -)');
  return { ...a, dry, probe, scenarios, pinnedExtra, repeats: num('repeats', probe ? 2 : 8, 1, true), seed: num('seed', 1, 0, true), budgetTotal: dry && a['budget-total'] === undefined ? null : num('budget-total', 0, 0.1), budgetSomi: num('budget-somi', 6, 0.1), budgetBare: num('budget-bare', 2, 0.1), budgetProbe: num('budget-probe', 0.5, 0.1), timeoutMin: num('timeout-min', 40, 0.001), timeoutProbeMin: num('timeout-probe-min', 5, 0.001), ceilingSomi: a['ceiling-somi'] ?? 'low' };
}

/** The `cost` block both arms' workspaces carry: the ceiling and every agent of `agentsDir` pinned to it (pin-all is not optional here). */
function costBlock({ ceiling, agentsDir }) {
  const names = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  if (names.length === 0) throw new Error(`no agents found under ${agentsDir}`);
  const cost = { ceiling, agents: Object.fromEntries(names.map((n) => [n, ceiling])) };
  validateCostConfig(cost);
  if (!VALID_COSTS.includes(ceiling)) throw new Error(`cost-ceiling: ceiling expected one of ${VALID_COSTS.join('|')}`);
  return cost;
}

/** --out resolved; it (or its deepest existing parent) must be a real path under HOME, the repository or the temp directory. */
function checkedOut(arg, home) {
  const abs = path.resolve(arg);
  let existing = abs; const rest = [];
  while (!fs.existsSync(existing) && existing !== path.dirname(existing)) { rest.unshift(path.basename(existing)); existing = path.dirname(existing); }
  const real = path.join(fs.realpathSync(existing), ...rest);
  const rp = (r) => { try { return fs.realpathSync(r); } catch { return null; } };
  // The sandbox masks /tmp, HOME and the repository only, so the temp directory counts only when it is /tmp or under it.
  const tmpReal = rp(os.tmpdir()); const slash = rp('/tmp');
  const roots = [rp(home), rp(REPO), tmpReal && slash && (tmpReal === slash || tmpReal.startsWith(`${slash}/`)) ? tmpReal : null].filter(Boolean);
  if (!roots.some((r) => real.startsWith(`${r}/`))) die('--out must be under HOME, the repository or /tmp: the sandbox hides only those from the draw');
  const l = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (l) ownDir(abs, l);
  return abs;
}
/** A real directory (no link) owned by this user with no group or other access, else die. */
function ownDir(dir, l = fs.lstatSync(dir, { throwIfNoEntry: false })) {
  if (!l || !l.isDirectory() || l.isSymbolicLink() || l.uid !== process.getuid() || (l.mode & 0o077) !== 0) die(`${path.basename(dir)}: must be a real directory owned by you with mode 0700`);
}
function readCapped(file, max) {
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const l = fs.fstatSync(fd);
    if (!l.isFile() || l.size > max) throw new Error('size');
    return fs.readFileSync(fd, 'utf8');
  } catch { return die(`${path.basename(file)} is not a readable regular file (no link) of at most ${max} bytes`, 1); } finally { if (fd !== null) fs.closeSync(fd); }
}
function treeHash(dir) {
  const m = lstatManifest(dir);
  if (!m?.ok) die('the plugin directory could not be hashed (a link or an unreadable entry)');
  return createHash('sha256').update(JSON.stringify(m.files)).digest('hex');
}
/** One run per --out: a fresh pid file is linked into place (fails when held); a stale lock is replaced by renaming over it. */
function lockOut(out) {
  const file = path.join(out, 'run.lock'); const mine = `${file}.${process.pid}`;
  fs.rmSync(mine, { force: true });
  fs.writeFileSync(mine, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  const held = () => { process.on('exit', () => { try { if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.rmSync(file, { force: true }); } catch { /* gone */ } }); };
  try { fs.linkSync(mine, file); fs.rmSync(mine); return held(); } catch (e) { if (e?.code !== 'EEXIST') { fs.rmSync(mine, { force: true }); die('could not lock --out'); } }
  let pid = NaN; try { pid = Number(fs.readFileSync(file, 'utf8').slice(0, 32).trim()); } catch { /* unreadable: treated as stale */ }
  let alive = false; try { alive = Number.isInteger(pid) && pid > 0 && process.kill(pid, 0); } catch { alive = false; }
  if (alive) { fs.rmSync(mine, { force: true }); die('another run is using this --out'); }
  fs.renameSync(mine, file);
  if (fs.readFileSync(file, 'utf8').trim() !== String(process.pid)) die('could not lock --out');
  return held();
}
const unlock = (dir) => { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) { fs.chmodSync(path.join(dir, e.name), 0o700); unlock(path.join(dir, e.name)); } } fs.chmodSync(dir, 0o700); } catch { /* gone */ } };
const rmTree = (dir) => {
  const l = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!l) return;
  if (l.isDirectory()) unlock(dir); // a link is removed, never followed
  fs.rmSync(dir, { recursive: true, force: true });
};
/** The reset text of a limit message: a short printable phrase, never anything that holds the token. */
const safeReset = (text, token) => { const t = redactToken(String(text ?? ''), token).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 60); return t === '' || t.includes('[REDACTED]') ? null : t; };

// ---- main --------------------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.model !== 'string' || !MODEL.test(args.model)) die('--model <alias> is required (letters, digits and . _ : [ ] -, starting with a letter or digit)');
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined) die('CLAUDE_CODE_OAUTH_TOKEN is already in the environment; the scorer must run without it (the driver reads the env file itself)');
  const rule = loadRule();
  if (!rule) die('benchmarks/usage-speed/rule.json is missing or invalid', 1);
  const home = process.env.HOME ?? os.homedir();
  const out = args.out === undefined ? null : checkedOut(args.out, home);
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-run-'));
  process.on('exit', () => rmTree(runTmp));

  let plugin = null;
  if (args['plugin-dir']) {
    plugin = path.resolve(args['plugin-dir']);
    if (!fs.statSync(plugin, { throwIfNoEntry: false })?.isDirectory() || fs.existsSync(path.join(plugin, 'tests/evals')) || fs.existsSync(path.join(plugin, '.somi'))) die('--plugin-dir must be a directory without tests/evals and .somi');
  } else if (!args.dry) { try { plugin = buildPlugin({ repoRoot: REPO, runTmp }); } catch (e) { die(`the plugin could not be packed: ${e.message}`, 1); } }
  let cost;
  try { cost = costBlock({ ceiling: args.ceilingSomi, agentsDir: path.join(plugin ?? REPO, 'agents') }); } catch (e) { die(`the cost config is not valid: ${String(e?.message ?? e).slice(0, 160)}`); }
  let gitSha = null; try { gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', timeout: 10000 }).trim(); } catch { /* not a checkout */ }

  // What each scenario is scored and run against, bound to the plan: a changed task, fixture or S1 suite refuses a resume.
  const material = {};
  for (const id of args.scenarios) {
    const sc = SCENARIOS[id];
    if (sc.kind === 'fixture') {
      const m = lstatManifest(path.join(REPO, FIXTURE));
      if (!m?.ok) die('the S1 fixture could not be read', 1);
      material[id] = createHash('sha256').update(JSON.stringify(m.files)).update(S1_TESTS).update(S1_PROBE).digest('hex');
    } else { const th = taskHash(path.join(REPO, sc.corpus, sc.task)); if (!th.ok) die(`scenario ${id}: task ${sc.task} is unusable: ${th.reason}`, 1); material[id] = th.hash; }
  }
  const caps = { somi: args.budgetSomi, bare: args.budgetBare, probe: args.budgetProbe };
  const plan = buildPlan({ phase: args.phase, seed: args.seed, model: args.model, pinnedExtra: args.pinnedExtra, ceilingSomi: args.ceilingSomi, pinAll: true, probe: args.probe, repeats: args.repeats,
    scenarios: args.scenarios.map((id) => ({ id, arms: args.probe ? ['somi'] : ['somi', 'bare'] })), caps, limits: { timeoutMin: args.timeoutMin, timeoutProbeMin: args.timeoutProbeMin }, material, ruleHash: rule.hash, gitSha, pluginHash: plugin ? treeHash(plugin) : null });
  const capOf = (d) => (args.probe ? caps.probe : caps[d.arm]);
  const minutesOf = () => (args.probe ? args.timeoutProbeMin : args.timeoutMin);

  // The leaf is created here (never recursively) and checked again after creation; the lock is taken before anything is read.
  if (out && !args.dry) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    try { fs.mkdirSync(out, { mode: 0o700 }); } catch (e) { if (e?.code !== 'EEXIST') die(`--out could not be created: ${e?.code ?? 'error'}`); }
    ownDir(out);
    lockOut(out);
  }
  // An existing --out must hold exactly this plan; its results are untrusted data until parsed.
  let entries = [];
  if (out && fs.existsSync(path.join(out, 'plan.json'))) {
    let stored; try { stored = JSON.parse(readCapped(path.join(out, 'plan.json'), MAX_PLAN_BYTES)); } catch { die('plan.json is not valid JSON', 1); }
    const diff = planMismatch(stored, plan, plan.pluginHash === null ? ['pluginHash'] : []);
    if (diff.length > 0) die(`plan.json differs from this run's plan in: ${diff.join(', ')}; use another --out or the original flags`, 1);
    const rf = path.join(out, 'results.jsonl');
    const parsed = parseResults(fs.existsSync(rf) ? readCapped(rf, MAX_RESULTS_BYTES) : '', plan);
    if (!parsed.ok) die(`results.jsonl refused: ${parsed.reason}`, 1);
    entries = parsed.entries;
  } else if (out && fs.existsSync(out) && fs.readdirSync(out).filter((n) => !n.startsWith('run.lock')).length > 0) die('--out holds files but no plan.json; refusing to write into it', 1);
  const todo = pendingDraws(plan, entries);
  const worst = todo.reduce((s, d) => s + capOf(d), 0);
  console.log(`plan: ${plan.draws.length} draw(s), ${todo.length} to run, phase ${plan.phase}, model ${args.model}, seed ${args.seed}, concurrency 1, rule ${rule.hash.slice(0, 12)}${rule.sealed ? ' (sealed)' : ' (draft)'}`);
  console.log(`worst case of the draws still to run: $${worst.toFixed(2)} (caps: SoMi $${caps.somi}, bare $${caps.bare}, probe $${caps.probe}) against a total budget of ${args.budgetTotal === null ? '(not given)' : `$${args.budgetTotal}, $${spentUsd(entries).toFixed(2)} already spent`}`);
  console.log(`cost config (both arms, same content): ceiling ${cost.ceiling}, pin-all on (${Object.keys(cost.agents).length} agents pinned to ${cost.ceiling})`);
  for (const d of plan.draws) console.log(`  ${String(d.order).padStart(3)} ${d.id} (cap $${capOf(d)}, ${minutesOf()} min)${todo.includes(d) ? '' : ' finished'}`);
  if (args.budgetTotal !== null && spentUsd(entries) + worst > args.budgetTotal && !args['force-budget']) die(`spent plus worst case $${(spentUsd(entries) + worst).toFixed(2)} exceeds --budget-total $${args.budgetTotal}; the run would stop on budget (pass --force-budget to accept that)`);

  // Scenario material: task scenarios are admitted before any draw; S1 reads the fixture author's text.
  const ctx = new Map();
  for (const id of [...new Set(todo.map((d) => d.scenario))]) {
    const sc = SCENARIOS[id];
    if (sc.kind === 'fixture') {
      const dir = path.join(REPO, FIXTURE); const plans = path.join(dir, '_somi/plans', sc.slug);
      const bare = `Implement the following change in this repository. Its plan is below; do not edit anything under .somi/.\n\n--- spec ---\n${fs.readFileSync(path.join(plans, 'spec.md'), 'utf8')}\n--- phase ---\n${fs.readFileSync(path.join(plans, 'phases/01-reject-expired.md'), 'utf8')}`;
      ctx.set(id, { dir, bare, somi: `/somi:code-loop ${sc.slug} phase 1, iteration ${sc.iteration}`, canary: `SOMI-CANARY-S1-${createHash('sha256').update(runTmp).digest('hex').slice(0, 16)}`, task: 'task02-code' });
      continue;
    }
    const dir = path.join(REPO, sc.corpus, sc.task); const th = taskHash(dir);
    if (!th.ok) die(`scenario ${id}: task ${sc.task} is unusable: ${th.reason}`, 1);
    let expect = null; let hash = th.hash;
    if (!sc.probe && !args.dry) {
      const adm = admitTask(dir, { repeats: 1 });
      if (!adm.ok || adm.hash !== th.hash) die(`task ${sc.task} is not admitted: ${adm.ok ? 'hash mismatch' : adm.reason}`, 1);
      expect = { total: adm.total, names: adm.names }; hash = adm.hash;
    }
    const text = taskText(th.task);
    ctx.set(id, { dir, expect, hash, bare: text, somi: armPrompt('somi', text), canary: th.task.canary, task: sc.task, corpus: path.join(REPO, sc.corpus) });
  }
  /** Workspace of one draw: {ws, before}. S1 stages the fixture with its plan tree as .somi (what the convergence harness does). */
  function prepare(id, tmp) {
    const c = ctx.get(id);
    if (SCENARIOS[id].kind !== 'fixture') return prepareWorkspace({ taskDir: c.dir, tmp, cost });
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-stage-'));
    try {
      fs.cpSync(c.dir, path.join(stage, 'fixture'), { recursive: true });
      fs.renameSync(path.join(stage, 'fixture/_somi'), path.join(stage, 'fixture/.somi'));
      return prepareWorkspace({ taskDir: stage, tmp, cost });
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }

  if (args.dry) {
    for (const id of ctx.keys()) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-draw-')); try { const { before } = prepare(id, tmp); console.log(`prepared ${id}: ${before.files.length} file(s)`); } finally { rmTree(tmp); } }
    console.log(`dry run: no claude call was made, nothing was written; sandbox ${args.sandbox ?? 'auto'}`);
    return 0;
  }

  const env = readEnvFile(path.resolve(args['env-file'] ?? path.join(REPO, '.somi/eval.env')));
  if (!env.ok) die(env.reason);
  const token = env.token;
  const claudeReal = resolveBinary(args.claude ?? 'claude') ?? (args.claude ?? 'claude');
  const sandboxMode = args.sandbox ?? 'auto';
  if (sandboxMode === 'off' && args.claude === undefined && !args['unsafe-no-sandbox']) die('--sandbox off with the real claude needs --unsafe-no-sandbox');
  const specFor = (arm) => sandboxSpec({ home, repoRoot: REPO, claudeReal, plugin: arm === 'somi' ? plugin : null });
  let sandboxOn = false;
  if (sandboxMode === 'auto') {
    sandboxOn = resolveBinary('bwrap') !== null && probeSandbox(specFor('somi')) && probeSandbox(specFor('bare'));
    if (!sandboxOn && !args['unsafe-no-sandbox']) die('bubblewrap is not usable here; install it, or pass --unsafe-no-sandbox to accept running the agent with full host access');
  }
  console.log(sandboxOn ? 'sandbox: bubblewrap (repository, real HOME and /tmp hidden; network shared)' : 'WARNING sandbox: none, the agent runs with the maintainer privileges on this host');
  const claude = sandboxOn ? claudeReal : (args.claude ?? 'claude');

  const planFile = path.join(out, 'plan.json'); const resultsFile = path.join(out, 'results.jsonl');
  if (!fs.existsSync(planFile)) fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 1)}\n`, { flag: 'wx', mode: 0o600 });
  const st = { spent: spentUsd(entries), halt: null, interrupted: false };
  const resultsFd = fs.openSync(resultsFile, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);

  /** One draw -> a results entry, or null when the run was interrupted (nothing partial is written). */
  async function doDraw(d) {
    const c = ctx.get(d.scenario); const cap = capOf(d);
    const drawDir = path.join(out, d.id);
    // An earlier halted attempt's files are kept aside, never deleted or appended to.
    if (fs.lstatSync(drawDir, { throwIfNoEntry: false })) { let n = 1; while (fs.existsSync(`${drawDir}.halted-${n}`)) n++; fs.renameSync(drawDir, `${drawDir}.halted-${n}`); }
    fs.mkdirSync(drawDir, { mode: 0o700 }); ownDir(drawDir);
    let charged = 0; // what this draw has cost or may have cost, for the entry of a fault or an interrupt
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-draw-'));
    const entry = (status, reason, o = {}) => ({ schema: 1, draw: d.id, status, reason, costUsd: 0, resumes: 0, computedTier: null, resetText: null, row: null, ...o });
    try {
      const { ws } = prepare(d.scenario, tmp);
      charged = cap; // a call may be in flight until runDraw returns
      const run = await runDraw({ model: args.model, arm: d.arm, prompt: c[d.arm], budget: cap, timeoutMs: minutesOf() * 60000, claude, env: childEnv({ token, tmp, tokenFd: args['token-fd'] }), cwd: ws, plugin, drawDir, token, tokenFd: args['token-fd'], canary: c.canary, task: c.task, absAb: path.join(REPO, 'tests/evals'), ownTmp: tmp, sandbox: sandboxOn ? specFor(d.arm) : null, kills, maxResumes: args.probe ? 0 : undefined });
      charged = !run.result && !run.error ? cap : run.cost;
      if (st.interrupted) return entry('halted', 'interrupted', { costUsd: charged, resumes: run.resumes });
      fs.writeFileSync(path.join(drawDir, 'stderr.txt'), run.stderr, { mode: 0o600 });
      const streamFile = path.join(drawDir, 'stream.jsonl');
      const tierInfo = d.arm === 'somi' ? resolveTier({ ws, streamFile }) : { tier: null, tierSource: 'none', computedTier: null };
      run.leaks = [...new Set([...run.leaks, ...inspectDraw({ ws, cfg: path.join(tmp, 'cfg'), after: lstatManifest(ws), drawDir, token, canary: c.canary, absAb: path.join(REPO, 'tests/evals') })])].sort();
      const cls = classify({ run, arm: d.arm, budget: cap });
      const costUsd = !run.result && !run.error ? cap : run.cost;
      const base = { costUsd, resumes: run.resumes, computedTier: tierInfo.computedTier };
      const halting = HALTING.includes(cls.reason) ? cls.reason : /^spawn-error/.test(cls.reason) ? 'spawn-error' : null;
      if (cls.outcome === 'invalid' && halting) return entry('halted', halting, { ...base, resetText: cls.reason === 'account-limit' ? safeReset(run.reset, token) : null });
      const scratch = { draw: d.id, outcome: cls.outcome, reason: redactToken(cls.reason, token), green: 0 };
      let score = null;
      if (args.probe) { if (['scored', 'paused'].includes(scratch.outcome)) Object.assign(scratch, { outcome: 'invalid', reason: 'probe' }); }
      else {
        const sc = SCENARIOS[d.scenario].kind === 'fixture' ? scoreS1(ws) : scoreHidden({ workspace: ws, hiddenDir: path.join(c.dir, 'hidden'), expect: c.expect, taskDir: c.dir, admittedHash: c.hash });
        if (!sc.ok) return entry('halted', 'harness-fault', base);
        // A tampered harness or a changed task is a terminal invalid row (the candidate's doing) and stops the run, as in the A/B driver.
        const stop = foldScore(scratch, sc);
        if (stop) st.halt = stop;
        score = { green: scratch.green, total: sc.total };
      }
      const { row, reason } = toRow({ scenario: d.scenario, arm: d.arm, phase: plan.phase, outcome: scratch.outcome, reason: scratch.reason, costUsd, durationMs: run.wallMs, turns: run.turns, model: args.model, pinnedExtra: args.pinnedExtra }, parseStream(streamFile), score, tierInfo);
      return entry('done', reason, { ...base, row });
    } catch (e) {
      process.stderr.write(`usage-bench: ${d.id}: harness fault: ${redactToken(String(e?.message ?? e), token).slice(0, 160)}\n`);
      return entry('halted', st.interrupted ? 'interrupted' : 'harness-fault', { costUsd: charged });
    } finally { rmTree(tmp); }
  }

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { st.interrupted = true; killAll(); });
  // Every line is checked by the reader that will refuse it later; one that would not be read back is recorded as a harness fault.
  const append = (e) => {
    if (!parseResults(`${JSON.stringify(e)}\n`, plan).ok) { process.stderr.write(`usage-bench: ${e.draw}: the entry would not be read back; recorded as a harness fault\n`); e = { ...e, status: 'halted', reason: 'harness-fault', row: null, resetText: null }; }
    fs.writeSync(resultsFd, `${JSON.stringify(e)}\n`); entries.push(e); st.spent += e.costUsd;
    return e;
  };
  for (const d of todo) {
    if (st.interrupted || st.halt) break;
    if (st.spent + capOf(d) > args.budgetTotal) {
      const e = { schema: 1, draw: d.id, status: 'halted', reason: 'budget-stop', costUsd: 0, resumes: 0, computedTier: null, resetText: null, row: null };
      append(e); st.halt = `${d.id}: budget-stop (spent $${st.spent.toFixed(2)} of $${args.budgetTotal})`; break;
    }
    console.log(`start ${d.id} (cap $${capOf(d)}, ${minutesOf()} min)`);
    const e = append(await doDraw(d));
    console.log(`done ${d.id}: ${e.status === 'done' ? e.row.outcome : 'HALTED'} (${e.reason}) $${e.costUsd.toFixed(2)} spent $${st.spent.toFixed(2)}`);
    if (e.status === 'halted') st.halt = `${d.id}: ${e.reason}${e.resetText ? `, resets ${e.resetText}` : ''}`;
  }
  if (st.interrupted) return 130;
  const report = buildBenchReport(plan, entries, st.halt);
  const tmpReport = path.join(out, 'report.txt.tmp');
  fs.rmSync(tmpReport, { force: true });
  fs.writeFileSync(tmpReport, `${report}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmpReport, path.join(out, 'report.txt'));
  console.log(`\n${report}\nresults: ${resultsFile}`);
  if (st.halt) { process.stderr.write(`usage-bench: HALTED, ${st.halt}\n`); return 1; }
  return 0;
}

main().then((c) => process.exit(c), (e) => die(`unexpected failure: ${String(e?.message ?? e).slice(0, 200)}`, 1));
