// Task admission for the A/B experiment: before a task costs a draw, its hidden suite must be shown fair and
// discriminating. admitTask is for repo-authored task material only (a committed task directory), never a candidate
// workspace: it copies task files into disposable workspaces and runs the suite's code. No model call, no network.
//
// admitTask(taskDir, {mutants = [], repeats = 20, timeoutMs}) -> {ok: true, hash, names, total, repeats, mutantsKilled} or
//   {ok: false, reason}; the reason starts with the refusing rule (canary, oracle, oracle2, nop, mutant, stability).
//   canary     canaryCheck(taskDir) is ok (its hash is returned).
//   oracle     fixture/ plus oracle/ (oracle files win) scores green === total with unique test names: that list is
//              what every later run is scored against (a name the oracle did not report is an integrity refusal).
//   oracle2    fixture/ plus oracle2/ scores green === total.
//   nop        on fixture/ alone every test whose name contains the tag [regression] must pass (it guards behaviour that
//              already exists) and every other test must fail, and not every test may pass: nothing would be left to implement.
//   mutant     each {name, file, find, replace} is checked up front, before any run (a file under oracle/, `find` once),
//              applied to the oracle's file, and must score green < total; `mutantsKilled` lists {name, failed}.
//   stability  `repeats` (1..50) oracle runs in one workspace all score green === total (state left by a run shows).
//   setup      an optional hidden/setup.mjs is run as `node hidden/setup.mjs <workspace>` in every workspace right after the
//              fixture and oracle files are copied (oracle, oracle2, nop, mutants, stability), for files git cannot hold on every
//              host (names with < > " ? and the like): it creates them from a table. A child process, argv array, a small
//              environment, a 20 s limit; a non-zero exit, a timeout or a spawn error refuses the task. POSIX only: on Windows a
//              task with a setup is refused with the reason saying so (the task is not run there, it does not fail). The live
//              driver must call the same setup before it takes the 'before' manifest snapshot, so the files are not candidate changes.
// Workspaces come from the manifest's file list (links are refused there), each in a fresh 0700 directory of
// os.tmpdir() removed by explicit path afterwards. The hidden suite runs from taskDir/hidden and taskDir is passed to the
// scorer, which alarms if the task changes during a run. The returned hash is for the draw driver to pass to the scorer
// as admittedHash. The task directory must not change while this runs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { esc, lstatManifest, validPath } from './manifest.mjs';
import { canaryCheck } from './task-store.mjs';
import { scoreHidden } from './score-hidden.mjs';

const MAX_MUTANTS = 64;
const MAX_REPEATS = 50;
const REGRESSION = /\[regression\]/;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const refuse = (rule, why) => ({ ok: false, reason: `${rule}: ${why}` });
const SETUP_MS = 20000;
class SetupFailure extends Error {}


function readOptions(taskDir, opts) {
  if (typeof taskDir !== 'string' || typeof opts !== 'object' || opts === null || Array.isArray(opts)) return { refusal: refuse('arguments', 'a task directory and an options object are required') };
  const { mutants = [], repeats = 20, timeoutMs } = opts;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > MAX_REPEATS) return { refusal: refuse('arguments', 'repeats must be an integer from 1 to 50') };
  if (!Array.isArray(mutants) || mutants.length > MAX_MUTANTS) return { refusal: refuse('arguments', 'mutants must be an array of at most 64') };
  return { mutants, repeats, timeoutMs };
}

// The task as admission reads it: the canary check's hash, the manifest's paths and whether it has a setup script.
function taskFor(taskDir, made) {
  const canary = canaryCheck(taskDir);
  if (!canary.ok) return { refusal: refuse('canary', canary.reason) };
  const m = lstatManifest(taskDir);
  if (!m?.ok) return { refusal: refuse('canary', 'the task directory changed while it was being read') };
  const setup = m.files.some((e) => e[0] === 'hidden/setup.mjs');
  if (setup && process.platform === 'win32') return { refusal: refuse('setup', 'the task needs a POSIX host and is skipped on this one') };
  return { ctx: { taskDir, root: taskDir.replace(/\/+$/, '') || '/', paths: m.files.map((e) => e[0]), setup, hash: canary.hash, made } };
}

const under = (ctx, dir) => ctx.paths.filter((p) => p.startsWith(`${dir}/`));
function copyTo(ctx, p, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(`${ctx.root}/${p}`, to);
}
function runSetup(ctx, ws) {
  const r = spawnSync(process.execPath, [path.resolve(ctx.root, 'hidden/setup.mjs'), ws], { cwd: ws, env: { PATH: process.env.PATH ?? '', HOME: ws }, stdio: 'ignore', timeout: SETUP_MS, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) throw new SetupFailure(r.error ? 'the setup could not run to the end' : `the setup exited with ${r.status}`);
}
// Fresh workspace holding the given task directories' files in order (later ones overwrite earlier ones).
function workspace(ctx, dirs, edit) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'admit-'));
  ctx.made.push(ws);
  for (const d of dirs) for (const p of under(ctx, d)) copyTo(ctx, p, path.join(ws, p.slice(d.length + 1)));
  if (ctx.setup) runSetup(ctx, ws);
  edit?.(ws);
  return ws;
}
const run = (ctx, rule, ws, expect) => { const s = scoreHidden({ workspace: ws, timeoutMs: ctx.timeoutMs, taskDir: ctx.taskDir, admittedHash: ctx.hash, expect }); return s.ok ? s : refuse(rule, s.reason); };

// One mutant, checked before any run: {name, file, mutated}, or a refusal.
function prepareMutant(ctx, mu, { prepared, oracleFiles }) {
  if (typeof mu !== 'object' || mu === null || typeof mu.name !== 'string' || !NAME.test(mu.name) || prepared.some((q) => q.name === mu.name)) return refuse('mutant', 'each mutant needs a unique name of 1..64 characters [A-Za-z0-9._-]');
  const { file, find, replace } = mu;
  if (typeof file !== 'string' || !validPath(file) || !oracleFiles.has(file)) return refuse('mutant', `${mu.name}: file is not a file under oracle/`);
  if (typeof find !== 'string' || find === '' || typeof replace !== 'string') return refuse('mutant', `${mu.name}: find must be a non-empty string and replace a string`);
  const src = fs.readFileSync(`${ctx.root}/oracle/${file}`, 'utf8');
  const count = src.split(find).length - 1;
  if (count !== 1) return refuse('mutant', `${mu.name}: find occurs ${count} times, it must occur exactly once`);
  return { name: mu.name, file, mutated: src.replace(find, () => replace) };
}
function prepareMutants(ctx, mutants) {
  const oracleFiles = new Set(under(ctx, 'oracle').map((p) => p.slice('oracle/'.length)));
  const prepared = [];
  for (const mu of mutants) {
    const entry = prepareMutant(ctx, mu, { prepared, oracleFiles });
    if (entry.ok === false) return { refusal: entry };
    prepared.push(entry);
  }
  return { prepared };
}

function nopRefusal(first, nop) {
  const passedOnNop = new Set(first.names.filter((n) => !nop.failed.includes(n)));
  const wrong = first.names.filter((n) => REGRESSION.test(n) !== passedOnNop.has(n));
  if (wrong.length > 0) return refuse('nop', `on the fixture alone every [regression] test must pass and every other test must fail; wrong: ${wrong.join(', ')}`);
  if (nop.green >= first.total) return refuse('nop', 'every test passes on the fixture alone, so nothing is left to implement');
  return null;
}
// The oracle's run fixes the test list; the second oracle must pass all of it, and the fixture alone must leave something to build.
function checkOracles(ctx) {
  const oracleWs = workspace(ctx, ['fixture', 'oracle']); const first = run(ctx, 'oracle', oracleWs);
  if (!first.ok) return { refusal: first };
  if (first.green !== first.total) return { refusal: refuse('oracle', `scores ${first.green}/${first.total}, failing ${first.failed.join(', ')}`) };
  const strict = (rule, ws) => run(ctx, rule, ws, { total: first.total, names: first.names });
  const second = strict('oracle2', workspace(ctx, ['fixture', 'oracle2']));
  if (!second.ok) return { refusal: second };
  if (second.green !== first.total) return { refusal: refuse('oracle2', `scores ${second.green}/${first.total}, failing ${second.failed.join(', ')}`) };
  const nop = strict('nop', workspace(ctx, ['fixture']));
  if (!nop.ok) return { refusal: nop };
  const wrong = nopRefusal(first, nop);
  return wrong ? { refusal: wrong } : { first, strict, oracleWs };
}

function killMutants(ctx, prepared, strict) {
  const killed = [];
  for (const mu of prepared) {
    const res = strict('mutant', workspace(ctx, ['fixture', 'oracle'], (ws) => fs.writeFileSync(path.join(ws, mu.file), mu.mutated)));
    if (!res.ok) return { refusal: refuse('mutant', `${mu.name}: ${res.reason}`) };
    if (res.green === res.total) return { refusal: refuse('mutant', `${mu.name} survives: ${res.green}/${res.total} tests still pass`) };
    killed.push({ name: mu.name, failed: res.failed });
  }
  return { killed };
}

// Repeated oracle runs in the same workspace must agree, so state a run leaves behind shows.
function stabilityRefusal({ first, strict, oracleWs }, repeats) {
  for (let i = 1; i < repeats; i++) {
    const again = strict('stability', oracleWs);
    if (!again.ok) return again;
    if (again.green !== first.total) return refuse('stability', `run ${i + 1} scored ${again.green}/${again.total} where the first scored ${first.green}/${first.total}`);
  }
  return null;
}

const failure = (e) => (e instanceof SetupFailure ? refuse('setup', e.message) : refuse('run', 'the task could not be admitted'));
const removeAll = (dirs) => { for (const ws of dirs) try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* disposable */ } };

/** See the header. */
export function admitTask(taskDir, opts = {}) {
  const made = [];
  try {
    const o = readOptions(taskDir, opts);
    if (o.refusal) return o.refusal;
    const task = taskFor(taskDir, made);
    if (task.refusal) return task.refusal;
    const ctx = { ...task.ctx, timeoutMs: o.timeoutMs };
    const mutants = prepareMutants(ctx, o.mutants);
    if (mutants.refusal) return mutants.refusal;
    const oracles = checkOracles(ctx);
    if (oracles.refusal) return oracles.refusal;
    const k = killMutants(ctx, mutants.prepared, oracles.strict);
    if (k.refusal) return k.refusal;
    const unstable = stabilityRefusal(oracles, o.repeats);
    if (unstable) return unstable;
    return { ok: true, hash: ctx.hash, names: oracles.first.names, total: oracles.first.total, repeats: o.repeats, mutantsKilled: k.killed };
  } catch (e) {
    return failure(e);
  } finally {
    removeAll(made);
  }
}
