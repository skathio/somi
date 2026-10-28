// somi-loop.mjs — deterministic state engine for the bounded loops.
//
// Zero-dependency: stdlib only (node:fs, node:path, node:child_process). No jq,
// no bash. Behavior-preserving — exit codes and stdout JSON shapes are frozen
// and reproduced exactly; see the bash original's header comment for the full
// rationale (state survives session death, caps are SoMi's central safety
// claim, etc).
//
// State: .somi/somi-state/loop/<slug>[.<iteration>].json under the project
// root (project-local, gitignored by SoMi's conventions). Never committed.
//
// Diff measurement covers tracked, staged AND untracked-but-not-ignored files.
// The untracked half is deliberate: `git diff` alone cannot see a file git has
// never been told about, so without it a new file costs nothing against the cap.
//
// Cap precedence (matches the gate tables): CLI flag > env var > .somi/config.json
// > default. `init` resolves once from that chain and freezes the result into state.
// `pass`/`check-diff` re-resolve their own cap on every call (the documented
// remedy for a fired gate, "adjust the env var and re-run", used to be inert): absent
// an explicit CLI flag or env var THIS invocation, the cap already in force for the
// loop stands unchanged (a `.somi/config.json` edit made mid-loop cannot silently
// reopen an already-resolved gate); see reresolveCap() in lib/loop-caps.mjs. Every cap value, at
// `init` and on re-resolution alike, is validated as a non-negative integer before
// use and rejected otherwise — a malformed value must not silently disable a gate.
// Diff measurement EXCLUDES .somi/ and .claude/ — artifact churn (progress/diary
// updates every pass) must not eat the code diff budget.
//
// Exit codes (callers branch on these — do not repurpose):
//   0  ok
//   2  max-passes-exceeded   (`pass` would exceed the cap)
//   3  diff-cap-exceeded     (`check-diff`: weighted lines over the cap;
//                             out-of-scope lines count double)
//   4  time-budget-exceeded  (`pass`: the /ship-loop run started by `run-start` on this slug is out of time)
//   64 usage / environment error (65: record-dispatch's resolver refused the agent)
//
// Subcommands (each prints one JSON object):
//   run-start      record a /ship-loop run's start and optional --max-minutes budget (kept on resume)
//   init           new loop state: baseline SHA, resolved caps, review_min from the sizing record
//   resume | stats the stored state
//   pass           next pass, or exit 2 (cap) / 4 (time budget); repeats review_min
//   check-diff     weighted cumulative diff against the baseline, or exit 3
//   review-scope   what the generalist reviewer reads this pass: delta (from/to trees, files) or full
//   record-dispatch  append the resolver's answer for --agent [--host] to the state
//   record-pass    append the verdict and counts, with the reviewed tree
//   finish         terminal status, cap overrides, dispatches
//
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REVIEW_SCOPES, reviewScope, snapshotTree } from './lib/loop-review.mjs';
import { computeDiff } from './lib/loop-diff.mjs';
import { dispatchEntry } from './lib/loop-dispatch.mjs';
import { LoopExit, PROG, usageError } from './lib/loop-exit.mjs';
import { applyCapOverride, configVal, firstDefined, reresolveCap, validateCap } from './lib/loop-caps.mjs';
import { startRun } from './lib/run-budget.mjs';
import { finish, init, pass, readConfig, resume } from './lib/loop-engine.mjs';
import { loadState, nowIso, requireState, saveState, stateFile } from './lib/loop-state.mjs';

// Unwinding with a LoopExit reaches the top-level handler, which writes its message to stderr and sets
// process.exitCode, letting Node exit naturally — avoids process.exit()'s risk of truncating buffered
// stdout/stderr writes on a pipe.
function die(msg) {
  throw usageError(msg);
}

function fail(code, msg) {
  throw new LoopExit(code, msg);
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
function deliver(result) {
  if (result.out !== undefined) console.log(JSON.stringify(result.out));
  if (result.message) process.stderr.write(`${result.message}\n`);
  process.exitCode = result.code;
}

function main() {
  requireGit();

  const root = projectRoot();
  const STATE_DIR = process.env.SOMI_LOOP_STATE_DIR || path.join(root, '.somi', 'somi-state', 'loop');

  // --- argument parsing (shared) ---------------------------------------------
  const argv = process.argv.slice(2);
  const CMD = argv[0] || '';
  let rest = argv.slice(1);

  let SLUG = '';
  let LOOP = 'code';
  let ITERATION = '';
  let FILES = '';
  let VERDICT = '';
  let BLOCKERS = '0';
  let MAJORS = '0';
  let STATUS = '';
  let AGENT = '';
  let HOST;
  let ARG_MAX_MINUTES = '';
  let FORCE = false;
  let ARG_MAX_PASSES = '';
  let ARG_DIFF_CAP = '';
  let ARG_SEVERITY = '';

  while (rest.length > 0) {
    const a = rest[0];
    switch (a) {
      case '--slug': SLUG = rest[1]; rest = rest.slice(2); break;
      case '--loop': LOOP = rest[1]; rest = rest.slice(2); break;
      case '--iteration': ITERATION = rest[1]; rest = rest.slice(2); break;
      case '--files': FILES = rest[1]; rest = rest.slice(2); break;
      case '--max-passes': ARG_MAX_PASSES = rest[1]; rest = rest.slice(2); break;
      case '--diff-cap': ARG_DIFF_CAP = rest[1]; rest = rest.slice(2); break;
      case '--severity-floor': ARG_SEVERITY = rest[1]; rest = rest.slice(2); break;
      case '--verdict': VERDICT = rest[1]; rest = rest.slice(2); break;
      case '--blockers': BLOCKERS = rest[1]; rest = rest.slice(2); break;
      case '--majors': MAJORS = rest[1]; rest = rest.slice(2); break;
      case '--status': STATUS = rest[1]; rest = rest.slice(2); break;
      case '--agent': AGENT = rest[1]; rest = rest.slice(2); break;
      case '--host': HOST = rest[1]; rest = rest.slice(2); break;
      case '--max-minutes': ARG_MAX_MINUTES = rest[1]; rest = rest.slice(2); break;
      case '--force': FORCE = true; rest = rest.slice(1); break;
      default: die(`unknown argument: ${a}`);
    }
  }

  if (!CMD) die('usage: somi-loop.mjs <run-start|init|resume|pass|check-diff|review-scope|record-dispatch|record-pass|finish|stats> --slug <slug> …');
  if (!SLUG) die('--slug is required');

  const SF = stateFile(STATE_DIR, SLUG, ITERATION);
  const ARGS = { slug: SLUG, loop: LOOP, iteration: ITERATION, files: FILES, force: FORCE, status: STATUS, maxPasses: ARG_MAX_PASSES, diffCap: ARG_DIFF_CAP, severity: ARG_SEVERITY, maxMinutes: ARG_MAX_MINUTES };
  const LIFECYCLE = { init, resume, pass, finish };

  if (CMD in LIFECYCLE) return deliver(LIFECYCLE[CMD]({ root, env: process.env, stateDir: STATE_DIR }, ARGS));

  const RUN_ROOT = path.dirname(STATE_DIR);
  switch (CMD) {
    case 'run-start': {
      const raw = firstDefined(ARG_MAX_MINUTES, process.env.SOMI_SHIP_LOOP_MAX_MINUTES, configVal(readConfig(root), ['ship_loop', 'max_minutes']));
      const max = raw === undefined ? null : validateCap(raw, 'max_minutes');
      if (max === 0) die('max_minutes: 0 would disable the budget; leave it unset instead');
      console.log(JSON.stringify(startRun(RUN_ROOT, SLUG, max, { force: FORCE })));
      break;
    }

    case 'check-diff': {
      requireState(SF);
      const state = loadState(SF);
      const { resolved: cap, override } = reresolveCap(process.env, state, 'diff_cap_lines', ARG_DIFF_CAP, nowIso());
      if (override) {
        applyCapOverride(state, override);
        saveState(SF, state); // persist the raise even if the gate below still fails
      }
      const { total, weighted, outOfScope } = computeDiff(root, state.baseline_sha, state.iteration_files);
      console.log(JSON.stringify({ diff_lines: total, weighted_lines: weighted, cap, out_of_scope: outOfScope }));
      if (cap > 0 && weighted > cap) {
        fail(3, `diff-cap-exceeded: weighted ${weighted} > cap ${cap} (out-of-scope counts double)`);
      }
      break;
    }

    case 'review-scope': {
      requireState(SF);
      const state = loadState(SF);
      const setting = firstDefined(process.env.SOMI_CODE_LOOP_REVIEW_SCOPE, configVal(readConfig(root), ['code_loop', 'review_scope']), 'delta');
      if (!REVIEW_SCOPES.includes(setting)) die(`review scope must be one of ${REVIEW_SCOPES.join('|')}, got ${JSON.stringify(setting)}`);
      console.log(JSON.stringify({ ...reviewScope(root, state, setting), ...(state.review_min ? { review_min: state.review_min } : {}) }));
      break;
    }

    case 'record-dispatch': {
      requireState(SF);
      if (!AGENT) die('record-dispatch requires --agent');
      const state = loadState(SF);
      const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const d = dispatchEntry({ root, installRoot, agent: AGENT, host: HOST, pass: state.pass });
      if (!d.ok) fail(d.code, `${PROG}: ${d.message}`);
      (state.dispatches ??= []).push(d.entry);
      saveState(SF, state);
      console.log(JSON.stringify(d.entry));
      break;
    }

    case 'record-pass': {
      requireState(SF);
      if (!VERDICT) die('record-pass requires --verdict');
      const state = loadState(SF);
      const { total } = computeDiff(root, state.baseline_sha, state.iteration_files);
      const entry = {
        pass: state.pass,
        verdict: VERDICT,
        blockers: Number(BLOCKERS),
        majors: Number(MAJORS),
        diff_lines: total,
        tree: snapshotTree(root) ?? undefined, // the reviewed tree: the next pass's delta starts here
        at: nowIso(),
      };
      state.history.push(entry);
      saveState(SF, state);
      console.log(JSON.stringify(state.history[state.history.length - 1]));
      break;
    }

    case 'stats': {
      requireState(SF);
      console.log(JSON.stringify(loadState(SF), null, 2));
      break;
    }

    default:
      die(`unknown subcommand: ${CMD}`);
  }
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
