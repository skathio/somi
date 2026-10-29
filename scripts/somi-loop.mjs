// somi-loop.mjs — command line of the deterministic state engine for the bounded loops: parses the arguments,
// calls the handler in lib/loop-engine.mjs and prints its result. No gate logic lives here.
//
// The gates live in lib/loop-engine.mjs, cap resolution (flag > env var > .somi/config.json > default) in
// lib/loop-caps.mjs, state in lib/loop-state.mjs, diff measurement in lib/loop-diff.mjs. Exit codes and stdout
// JSON shapes are frozen; callers branch on them: 0 ok, 2 max passes, 3 diff cap, 4 time budget, 5 circuit breaker
// (step after-review), 64 usage, 65 record-dispatch's resolver refused the agent, 70 internal error (step only).
//
// Subcommands (each prints one JSON object): run-start, init, resume, stats, pass, check-diff, review-scope,
// record-dispatch, record-pass, finish, and `step <open|after-code|after-review|close|status>`: the composite steps of
// lib/loop-step.mjs, arguments as `--flag value` (--findings and --fixed as JSON text, --reviewers comma-separated), the
// response on stdout as one JSON line, its `exit` as the exit code, nothing on stderr: the response carries the refusal,
// and an internal error (70) goes to <state dir>/step-errors.log, never to the stderr a model reads.
//
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LoopExit, usageError } from './lib/loop-exit.mjs';
import { runStep } from './lib/loop-step.mjs';
import { checkDiff, finish, init, pass, recordDispatch, recordPass, resume, reviewScope, runStart } from './lib/loop-engine.mjs';

// Unwinding with a LoopExit reaches the top-level handler, which writes its message to stderr and sets
// process.exitCode, letting Node exit naturally — avoids process.exit()'s risk of truncating buffered
// stdout/stderr writes on a pipe.
function die(msg) {
  throw usageError(msg);
}

function requireGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    die('requires git');
  }
}

function projectRoot() {
  let b = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (b.includes('${')) b = process.cwd();
  return b;
}

// A handler's result: its one JSON object on stdout, its message on stderr, its code as the exit code.
function deliver(result, space) {
  if (result.out !== undefined) console.log(JSON.stringify(result.out, null, space));
  if (result.message) process.stderr.write(`${result.message}\n`);
  process.exitCode = result.code;
}

// subcommand -> handler, and the JSON indent where it is not the compact default (`stats` is read by people).
const COMMANDS = {
  'run-start': { handler: runStart }, init: { handler: init }, resume: { handler: resume }, stats: { handler: resume, space: 2 },
  pass: { handler: pass }, 'check-diff': { handler: checkDiff }, 'review-scope': { handler: reviewScope },
  'record-dispatch': { handler: recordDispatch }, 'record-pass': { handler: recordPass }, finish: { handler: finish },
};
const STEP_FLAGS = ['slug', 'loop', 'iteration', 'files', 'host', 'max-passes', 'diff-cap', 'agent', 'review-mode', 'review-scope', 'reviewers', 'verdict', 'blockers', 'majors', 'findings', 'review', 'fixed', 'status'];
const LOG_MAX = 65536; // shortcut: the log stops growing here and is never rotated; rotate (or truncate) when a person reads it

// The step's arguments from `--flag value` pairs, as runStep takes them. A flag it does not know, a repeated one or one without a value is a usage error.
function stepArgs(argv) {
  const args = { step: argv[0] };
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !STEP_FLAGS.includes(key) || argv[i + 1] === undefined) die(`unknown argument or missing value: ${argv[i]}`);
    if (Object.hasOwn(args, key.replaceAll('-', '_'))) die(`repeated argument: ${argv[i]}`);
    args[key.replaceAll('-', '_')] = argv[i + 1];
  }
  for (const k of ['findings', 'fixed']) if (args[k] !== undefined) { try { args[k] = JSON.parse(args[k]); } catch { die(`--${k} expects JSON text`); } }
  if (args.reviewers !== undefined) args.reviewers = args.reviewers.split(',');
  return args;
}

// Where an internal error's one JSON line goes: appended to `file`, not through a link, not past LOG_MAX. A failure here is swallowed by runStep.
function logTo(file) {
  return (line) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try { if (fs.fstatSync(fd).isFile() && fs.fstatSync(fd).size < LOG_MAX) fs.writeSync(fd, `${line.slice(0, 8192)}\n`); } finally { fs.closeSync(fd); }
  };
}

const FLAGS = {
  '--slug': 'slug', '--loop': 'loop', '--iteration': 'iteration', '--files': 'files', '--max-passes': 'maxPasses',
  '--diff-cap': 'diffCap', '--severity-floor': 'severity', '--verdict': 'verdict', '--blockers': 'blockers',
  '--majors': 'majors', '--status': 'status', '--agent': 'agent', '--host': 'host', '--max-minutes': 'maxMinutes',
};

function step(argv) {
  const root = projectRoot();
  const stateDir = process.env.SOMI_LOOP_STATE_DIR || path.join(root, '.somi', 'somi-state', 'loop');
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resp = runStep({ root, env: process.env, stateDir, installRoot, via: 'cli', log: logTo(path.join(stateDir, 'step-errors.log')) }, stepArgs(argv));
  deliver({ out: resp, code: resp.exit }, undefined);
}

function main() {
  requireGit();

  const cmd = process.argv[2] || '';
  if (cmd === 'step') return step(process.argv.slice(3));
  const args = { slug: '', loop: 'code', iteration: '', files: '', verdict: '', blockers: '0', majors: '0', status: '', agent: '', host: undefined, maxMinutes: '', force: false, maxPasses: '', diffCap: '', severity: '' };
  for (let rest = process.argv.slice(3); rest.length > 0;) {
    if (rest[0] === '--force') { args.force = true; rest = rest.slice(1); continue; }
    if (!Object.hasOwn(FLAGS, rest[0])) die(`unknown argument: ${rest[0]}`);
    args[FLAGS[rest[0]]] = rest[1];
    rest = rest.slice(2);
  }

  if (!cmd) die('usage: somi-loop.mjs <run-start|init|resume|pass|check-diff|review-scope|record-dispatch|record-pass|finish|stats> --slug <slug> …, or step <name> …');
  if (!args.slug) die('--slug is required');
  if (!Object.hasOwn(COMMANDS, cmd)) die(`unknown subcommand: ${cmd}`);

  const root = projectRoot();
  const stateDir = process.env.SOMI_LOOP_STATE_DIR || path.join(root, '.somi', 'somi-state', 'loop');
  const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { handler, space } = COMMANDS[cmd];
  deliver(handler({ root, env: process.env, stateDir, installRoot }, args), space);
}

try {
  main();
} catch (e) {
  if (e instanceof LoopExit) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = e.code;
  } else {
    throw e;
  }
}
