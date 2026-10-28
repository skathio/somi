// somi-loop.mjs — command line of the deterministic state engine for the bounded loops: parses the arguments,
// calls the handler in lib/loop-engine.mjs and prints its result. No gate logic lives here.
//
// The gates live in lib/loop-engine.mjs, cap resolution (flag > env var > .somi/config.json > default) in
// lib/loop-caps.mjs, state in lib/loop-state.mjs, diff measurement in lib/loop-diff.mjs. Exit codes and stdout
// JSON shapes are frozen; callers branch on them: 0 ok, 2 max passes, 3 diff cap, 4 time budget, 64 usage,
// 65 record-dispatch's resolver refused the agent.
//
// Subcommands (each prints one JSON object): run-start, init, resume, stats, pass, check-diff, review-scope,
// record-dispatch, record-pass, finish.
//
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LoopExit, usageError } from './lib/loop-exit.mjs';
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
const FLAGS = {
  '--slug': 'slug', '--loop': 'loop', '--iteration': 'iteration', '--files': 'files', '--max-passes': 'maxPasses',
  '--diff-cap': 'diffCap', '--severity-floor': 'severity', '--verdict': 'verdict', '--blockers': 'blockers',
  '--majors': 'majors', '--status': 'status', '--agent': 'agent', '--host': 'host', '--max-minutes': 'maxMinutes',
};

function main() {
  requireGit();

  const cmd = process.argv[2] || '';
  const args = { slug: '', loop: 'code', iteration: '', files: '', verdict: '', blockers: '0', majors: '0', status: '', agent: '', host: undefined, maxMinutes: '', force: false, maxPasses: '', diffCap: '', severity: '' };
  for (let rest = process.argv.slice(3); rest.length > 0;) {
    if (rest[0] === '--force') { args.force = true; rest = rest.slice(1); continue; }
    if (!Object.hasOwn(FLAGS, rest[0])) die(`unknown argument: ${rest[0]}`);
    args[FLAGS[rest[0]]] = rest[1];
    rest = rest.slice(2);
  }

  if (!cmd) die('usage: somi-loop.mjs <run-start|init|resume|pass|check-diff|review-scope|record-dispatch|record-pass|finish|stats> --slug <slug> …');
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
