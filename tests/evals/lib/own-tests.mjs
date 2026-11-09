// The tests a draw wrote, scored the way task admission scores a hidden suite: they run on the reference solution and on each of its
// recorded mutants. That says whether they would catch a real defect, which a passing test suite alone does not. Bare and SoMi are scored
// the same way. The tests are candidate code, so the caller runs them in the same sandbox as the draw, and they get a fresh copy of the
// task, a PATH-only environment and a time limit.
//
// Each test case is judged on its own. A case that fails on the reference pins something the reference does differently: often a detail
// the task leaves open, sometimes the draw's own bug. It does not count either way. The cases that agree with the reference must catch the
// mutants: a mutant is killed when one of them fails on it.
//
// scoreOwnTests({ workspace, taskDir, task, mutants, wrap, timeoutMs }) -> { tests, cases, agree, killed, total } or { tests: 0 }.
//   tests        how many test files the draw added or changed under the task's test folder
//   cases        the test cases those files ran on the reference; agree, how many of them passed there
//   killed       the mutants on which at least one agreeing case failed, out of total
//   wrap         (command, args, rw) -> { command, args }, to run inside a sandbox; by default the command runs as it is

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_FILE = /\.test\.(mjs|cjs|js)$/;
const RUN_MS = 60000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const REPORTER_FILE = '.own-tests-reporter.mjs';
// One line per finished test case, keyed by file, depth and name. A file's own record and a suite are not cases; a skip does not pass.
const REPORTER = `import path from 'node:path';
export default async function* (source) {
  for await (const e of source) {
    if (e.type !== 'test:pass' && e.type !== 'test:fail') continue;
    const d = e.data;
    const file = typeof d.file === 'string' ? path.basename(d.file) : '';
    const own = d.nesting === 0 && (d.name === file || d.name === d.file || d.name.endsWith('/' + file));
    if (d.details?.type !== 'test' || own) continue;
    yield JSON.stringify({ key: [file, d.nesting, d.name].join('\\u0000'), ok: e.type === 'test:pass' && d.skip !== true && d.todo !== true }) + '\\n';
  }
}
`;

// The report as key -> passed. A key that repeats gets a count, so two cases with one name are both kept.
function casesOf(stdout) {
  const out = new Map();
  for (const line of String(stdout ?? '').split('\n')) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (typeof rec?.key !== 'string') continue;
    let key = rec.key;
    for (let n = 1; out.has(key); n++) key = `${rec.key}\u0000${n}`;
    out.set(key, rec.ok === true);
  }
  return out;
}

function files(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) return [];
    if (e.isDirectory()) return files(p, base);
    return e.isFile() ? [path.relative(base, p)] : [];
  });
}

function copyTree(from, to) {
  for (const rel of files(from)) {
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(from, rel), path.join(to, rel));
  }
}

export function ownTestFiles({ workspace, taskDir, task }) {
  const dir = task.test_dir;
  if (typeof dir !== 'string' || dir.includes('..')) return [];
  const mine = path.join(workspace, dir);
  const theirs = path.join(taskDir, 'fixture', dir);
  return files(mine).filter((rel) => {
    const was = path.join(theirs, rel);
    return !fs.existsSync(was) || !fs.readFileSync(was).equals(fs.readFileSync(path.join(mine, rel)));
  });
}

// The reference solution, with the draw's own test files laid over it. False when the task's setup fails.
function stageReference(tmp, { workspace, taskDir, task, changed }) {
  copyTree(path.join(taskDir, 'fixture'), tmp);
  copyTree(path.join(taskDir, 'oracle'), tmp);
  const setup = path.join(taskDir, 'hidden', 'setup.mjs');
  if (fs.existsSync(setup) && spawnSync(process.execPath, [setup, tmp], { cwd: tmp, env: { PATH: process.env.PATH ?? '', HOME: tmp }, stdio: 'ignore', timeout: 20000 }).status !== 0) return false;
  for (const rel of changed) {
    const to = path.join(tmp, task.test_dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(workspace, task.test_dir, rel), to);
  }
  return true;
}

// A mutant counts only where its text is found exactly once, and each one is undone before the next.
function killedMutants(tmp, mutants, run) {
  let killed = 0;
  for (const mu of mutants) {
    const file = path.join(tmp, mu.file);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (text === null || text.split(mu.find).length !== 2) continue;
    fs.writeFileSync(file, text.replace(mu.find, mu.replace));
    if (!run()) killed += 1;
    fs.writeFileSync(file, text);
  }
  return killed;
}

export function scoreOwnTests({ workspace, taskDir, task, mutants = [], wrap = (command, args) => ({ command, args }), timeoutMs = RUN_MS }) {
  if (task.runner !== 'node-test') return { tests: 0 };
  const changed = ownTestFiles({ workspace, taskDir, task });
  const runnable = changed.filter((f) => TEST_FILE.test(f));
  if (runnable.length === 0) return { tests: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-own-tests-'));
  try {
    if (!stageReference(tmp, { workspace, taskDir, task, changed })) return { tests: runnable.length, cases: 0, agree: 0, killed: 0, total: mutants.length, error: 'setup' };
    fs.writeFileSync(path.join(tmp, REPORTER_FILE), REPORTER);
    const run = () => {
      const { command, args } = wrap(process.execPath, ['--test', `--test-reporter=./${REPORTER_FILE}`, ...runnable.map((f) => path.join(task.test_dir, f))], [tmp]);
      return casesOf(spawnSync(command, args, { cwd: tmp, env: { PATH: process.env.PATH ?? '', HOME: tmp }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_OUTPUT, timeout: timeoutMs, killSignal: 'SIGKILL' }).stdout);
    };
    const reference = run();
    const agreeing = [...reference].filter(([, ok]) => ok).map(([key]) => key);
    const base = { tests: runnable.length, cases: reference.size, agree: agreeing.length, total: mutants.length };
    if (agreeing.length === 0) return { ...base, killed: 0 };
    // A mutant survives when every agreeing case still passes on it; a case that no longer runs at all has failed.
    return { ...base, killed: killedMutants(tmp, mutants, () => { const on = run(); return agreeing.every((key) => on.get(key) === true); }) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
