// The tests a draw wrote, scored the way task admission scores a hidden suite: they must pass on the reference solution and fail on each of
// its recorded mutants. That says whether they would catch a real defect, which a passing test suite alone does not. Bare and SoMi are
// scored the same way. The tests are candidate code, so the caller runs them in the same sandbox as the draw, and they get a fresh copy of
// the task, a PATH-only environment and a time limit.
//
// scoreOwnTests({ workspace, taskDir, task, mutants, wrap, timeoutMs }) -> { tests, oracle_pass, killed, total } or { tests: 0 }.
//   tests        how many test files the draw added or changed under the task's test folder
//   oracle_pass  whether they pass on the reference solution; when they do not, nothing is counted as killed
//   wrap         (command, args, rw) -> { command, args }, to run inside a sandbox; by default the command runs as it is

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_FILE = /\.test\.(mjs|cjs|js)$/;
const RUN_MS = 60000;

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
    if (!stageReference(tmp, { workspace, taskDir, task, changed })) return { tests: runnable.length, oracle_pass: false, error: 'setup' };
    const run = () => {
      const { command, args } = wrap(process.execPath, ['--test', ...runnable.map((f) => path.join(task.test_dir, f))], [tmp]);
      return spawnSync(command, args, { cwd: tmp, env: { PATH: process.env.PATH ?? '', HOME: tmp }, stdio: 'ignore', timeout: timeoutMs, killSignal: 'SIGKILL' }).status === 0;
    };
    if (!run()) return { tests: runnable.length, oracle_pass: false, killed: 0, total: mutants.length };
    return { tests: runnable.length, oracle_pass: true, killed: killedMutants(tmp, mutants, run), total: mutants.length };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
