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
// Workspaces come from the manifest's file list (links are refused there), each in a fresh 0700 directory of
// os.tmpdir() removed by explicit path afterwards. The hidden suite runs from taskDir/hidden and taskDir is passed to the
// scorer, which alarms if the task changes during a run. The returned hash is for the draw driver to pass to the scorer
// as admittedHash. The task directory must not change while this runs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esc, lstatManifest, validPath } from './manifest.mjs';
import { canaryCheck } from './task-store.mjs';
import { scoreHidden } from './score-hidden.mjs';

const MAX_MUTANTS = 64;
const MAX_REPEATS = 50;
const REGRESSION = /\[regression\]/;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const refuse = (rule, why) => ({ ok: false, reason: `${rule}: ${why}` });


/** See the header. */
export function admitTask(taskDir, opts = {}) {
  const made = [];
  try {
    if (typeof taskDir !== 'string' || typeof opts !== 'object' || opts === null || Array.isArray(opts)) return refuse('arguments', 'a task directory and an options object are required');
    const { mutants = [], repeats = 20, timeoutMs } = opts;
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > MAX_REPEATS) return refuse('arguments', 'repeats must be an integer from 1 to 50');
    if (!Array.isArray(mutants) || mutants.length > MAX_MUTANTS) return refuse('arguments', 'mutants must be an array of at most 64');
    const canary = canaryCheck(taskDir);
    if (!canary.ok) return refuse('canary', canary.reason);
    const m = lstatManifest(taskDir); const root = taskDir.replace(/\/+$/, '') || '/';
    if (!m?.ok) return refuse('canary', 'the task directory changed while it was being read');
    const under = (dir) => m.files.map((e) => e[0]).filter((p) => p.startsWith(`${dir}/`));
    // Fresh workspace holding the given task directories' files in order (later ones overwrite earlier ones).
    const workspace = (dirs, edit) => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'admit-'));
      made.push(ws);
      for (const d of dirs) for (const p of under(d)) {
        const to = path.join(ws, p.slice(d.length + 1));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(`${root}/${p}`, to);
      }
      edit?.(ws);
      return ws;
    };
    const run = (rule, ws, expect) => { const s = scoreHidden({ workspace: ws, timeoutMs, taskDir, admittedHash: canary.hash, expect }); return s.ok ? s : refuse(rule, s.reason); };

    const oracleFiles = new Set(under('oracle').map((p) => p.slice('oracle/'.length)));
    const prepared = [];
    for (const mu of mutants) {
      if (typeof mu !== 'object' || mu === null || typeof mu.name !== 'string' || !NAME.test(mu.name) || prepared.some((q) => q.name === mu.name)) return refuse('mutant', 'each mutant needs a unique name of 1..64 characters [A-Za-z0-9._-]');
      const { file, find, replace } = mu;
      if (typeof file !== 'string' || !validPath(file) || !oracleFiles.has(file)) return refuse('mutant', `${mu.name}: file is not a file under oracle/`);
      if (typeof find !== 'string' || find === '' || typeof replace !== 'string') return refuse('mutant', `${mu.name}: find must be a non-empty string and replace a string`);
      const src = fs.readFileSync(`${root}/oracle/${file}`, 'utf8');
      const count = src.split(find).length - 1;
      if (count !== 1) return refuse('mutant', `${mu.name}: find occurs ${count} times, it must occur exactly once`);
      prepared.push({ name: mu.name, file, mutated: src.replace(find, () => replace) });
    }
    const oracleWs = workspace(['fixture', 'oracle']); const first = run('oracle', oracleWs);
    if (!first.ok) return first;
    if (first.green !== first.total) return refuse('oracle', `scores ${first.green}/${first.total}, failing ${first.failed.join(', ')}`);
    const { total } = first; const strict = (rule, ws) => run(rule, ws, { total, names: first.names });
    const second = strict('oracle2', workspace(['fixture', 'oracle2'])); if (!second.ok) return second;
    if (second.green !== total) return refuse('oracle2', `scores ${second.green}/${total}, failing ${second.failed.join(', ')}`);
    const nop = strict('nop', workspace(['fixture'])); if (!nop.ok) return nop;
    const passedOnNop = new Set(first.names.filter((n) => !nop.failed.includes(n)));
    const wrong = first.names.filter((n) => REGRESSION.test(n) !== passedOnNop.has(n));
    if (wrong.length > 0) return refuse('nop', `on the fixture alone every [regression] test must pass and every other test must fail; wrong: ${wrong.join(', ')}`);
    if (nop.green >= total) return refuse('nop', 'every test passes on the fixture alone, so nothing is left to implement');
    const killed = [];
    for (const mu of prepared) {
      const res = strict('mutant', workspace(['fixture', 'oracle'], (ws) => fs.writeFileSync(path.join(ws, mu.file), mu.mutated)));
      if (!res.ok) return refuse('mutant', `${mu.name}: ${res.reason}`);
      if (res.green === res.total) return refuse('mutant', `${mu.name} survives: ${res.green}/${res.total} tests still pass`);
      killed.push({ name: mu.name, failed: res.failed });
    }
    for (let i = 1; i < repeats; i++) {
      const again = strict('stability', oracleWs);
      if (!again.ok) return again;
      if (again.green !== total) return refuse('stability', `run ${i + 1} scored ${again.green}/${again.total} where the first scored ${first.green}/${first.total}`);
    }
    return { ok: true, hash: canary.hash, names: first.names, total, repeats, mutantsKilled: killed };
  } catch {
    return refuse('run', 'the task could not be admitted');
  } finally {
    for (const ws of made) try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* disposable */ }
  }
}
