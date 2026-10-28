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

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyBriefOnly } from './lib/tier-record.mjs';
import { REVIEW_SCOPES, reviewMinFor, reviewScope, snapshotTree } from './lib/loop-review.mjs';
import { computeDiff } from './lib/loop-diff.mjs';
import { dispatchEntry } from './lib/loop-dispatch.mjs';
import { checkRun, startRun } from './lib/run-budget.mjs';
import { loadConfig } from './lib/config-files.mjs';
import { LoopExit, usageError } from './lib/loop-exit.mjs';
import { applyCapOverride, configVal, firstDefined, resolveInitCap, reresolveCap, validateCap } from './lib/loop-caps.mjs';

const PROG = 'somi-loop';

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

// The effective config (global, with the project's .somi/config.json over it); an unreadable or
// invalid file reads as unconfigured, so the documented defaults apply.
function readConfig(root) {
  try {
    return loadConfig(root).config;
  } catch {
    return {};
  }
}

function nowIso() {
  // `date -u +%Y-%m-%dT%H:%M:%SZ` — no milliseconds.
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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

  function stateFile() {
    let name = SLUG;
    if (ITERATION) name = `${SLUG}.${ITERATION}`;
    return path.join(STATE_DIR, `${name}.json`);
  }
  const SF = stateFile();

  function requireState() {
    if (!fs.existsSync(SF)) die(`no loop state at ${SF} — run init first`);
  }

  function loadState() {
    return JSON.parse(fs.readFileSync(SF, 'utf8'));
  }

  function saveState(state) {
    fs.writeFileSync(SF, JSON.stringify(state));
  }

  const RUN_ROOT = path.dirname(STATE_DIR);
  switch (CMD) {
    case 'run-start': {
      const raw = firstDefined(ARG_MAX_MINUTES, process.env.SOMI_SHIP_LOOP_MAX_MINUTES, configVal(readConfig(root), ['ship_loop', 'max_minutes']));
      const max = raw === undefined ? null : validateCap(raw, 'max_minutes');
      if (max === 0) die('max_minutes: 0 would disable the budget; leave it unset instead');
      console.log(JSON.stringify(startRun(RUN_ROOT, SLUG, max, { force: FORCE })));
      break;
    }

    case 'init': {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      if (fs.existsSync(SF) && !FORCE) {
        let status;
        try {
          status = JSON.parse(fs.readFileSync(SF, 'utf8')).status;
        } catch {
          status = undefined;
        }
        if (status === 'running') {
          die(`loop state already running at ${SF} — use 'resume' to continue it, or 'init --force' to discard`);
        }
      }

      // A brief-only work item (a plan directory with no phases/) exists only for the sized, human-
      // approved small tier of /ship-loop: refuse it without the tier record's approval stamp.
      const planDir = path.join(root, '.somi', 'plans', SLUG);
      if (LOOP === 'code' && fs.existsSync(planDir) && !fs.existsSync(path.join(planDir, 'phases'))) {
        const v = verifyBriefOnly(root, SLUG);
        if (!v.ok) die(`brief-only work item refused: ${v.reason}; use /plan or /ship-loop`);
      }

      // Cap resolution: CLI > env > config > default (per loop type), through the
      // same CAP_ENV / CAP_CONFIG_SECTION / CAP_DEFAULT tables reresolveCap() uses,
      // and validated the same way -- a malformed value dies here rather than
      // silently resolving to a fail-open NaN/null.
      const config = readConfig(root);
      let maxPasses;
      let diffCap;
      let sevFloor;
      if (LOOP === 'plan') {
        maxPasses = resolveInitCap(process.env, config, 'plan', 'max_passes', ARG_MAX_PASSES);
        sevFloor = firstDefined(ARG_SEVERITY, process.env.SOMI_PLAN_LOOP_SEVERITY_FLOOR, configVal(config, ['plan_loop', 'severity_floor']));
        diffCap = 0; // plan loops have no diff cap
      } else {
        maxPasses = resolveInitCap(process.env, config, 'code', 'max_passes', ARG_MAX_PASSES);
        sevFloor = firstDefined(ARG_SEVERITY, process.env.SOMI_CODE_LOOP_SEVERITY_FLOOR, configVal(config, ['code_loop', 'severity_floor']));
        diffCap = resolveInitCap(process.env, config, 'code', 'diff_cap_lines', ARG_DIFF_CAP);
      }
      sevFloor = firstDefined(sevFloor, 'Major');

      let baseline;
      try {
        baseline = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      } catch {
        die('cannot resolve HEAD');
      }

      const filesJson = FILES.split(' ').filter((s) => s.length > 0);

      const state = {
        slug: SLUG,
        loop: LOOP,
        iteration: ITERATION,
        baseline_sha: baseline,
        started: nowIso(),
        status: 'running',
        caps: { max_passes: maxPasses, diff_cap_lines: diffCap, severity_floor: sevFloor },
        iteration_files: filesJson,
        pass: 0,
        history: [],
      };
      if (LOOP === 'code') state.review_min = reviewMinFor(root, SLUG) ?? undefined; // undefined: not serialised
      saveState(state);
      console.log(JSON.stringify({ baseline_sha: state.baseline_sha, caps: state.caps, state_file: SF, ...(state.review_min ? { review_min: state.review_min } : {}) }));
      break;
    }

    case 'resume': {
      requireState();
      console.log(JSON.stringify(loadState()));
      break;
    }

    case 'pass': {
      requireState();
      const state = loadState();
      const { resolved: max, override } = reresolveCap(process.env, state, 'max_passes', ARG_MAX_PASSES, nowIso());
      if (override) {
        applyCapOverride(state, override);
        saveState(state); // persist the raise even if the gate below still fails
      }
      const cur = state.pass;
      if (cur + 1 > max) {
        fail(2, `max-passes-exceeded: pass ${cur + 1} > cap ${max}`);
      }
      const run = checkRun(RUN_ROOT, SLUG);
      if (run?.over) fail(4, `time-budget-exceeded: ${run.elapsed_minutes} of ${run.max_minutes} minutes used by this run`);
      state.pass = cur + 1;
      saveState(state);
      console.log(JSON.stringify({ pass: state.pass, max_passes: max, ...(state.review_min ? { review_min: state.review_min } : {}) }));
      break;
    }

    case 'check-diff': {
      requireState();
      const state = loadState();
      const { resolved: cap, override } = reresolveCap(process.env, state, 'diff_cap_lines', ARG_DIFF_CAP, nowIso());
      if (override) {
        applyCapOverride(state, override);
        saveState(state); // persist the raise even if the gate below still fails
      }
      const { total, weighted, outOfScope } = computeDiff(root, state.baseline_sha, state.iteration_files);
      console.log(JSON.stringify({ diff_lines: total, weighted_lines: weighted, cap, out_of_scope: outOfScope }));
      if (cap > 0 && weighted > cap) {
        fail(3, `diff-cap-exceeded: weighted ${weighted} > cap ${cap} (out-of-scope counts double)`);
      }
      break;
    }

    case 'review-scope': {
      requireState();
      const state = loadState();
      const setting = firstDefined(process.env.SOMI_CODE_LOOP_REVIEW_SCOPE, configVal(readConfig(root), ['code_loop', 'review_scope']), 'delta');
      if (!REVIEW_SCOPES.includes(setting)) die(`review scope must be one of ${REVIEW_SCOPES.join('|')}, got ${JSON.stringify(setting)}`);
      console.log(JSON.stringify({ ...reviewScope(root, state, setting), ...(state.review_min ? { review_min: state.review_min } : {}) }));
      break;
    }

    case 'record-dispatch': {
      requireState();
      if (!AGENT) die('record-dispatch requires --agent');
      const state = loadState();
      const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const d = dispatchEntry({ root, installRoot, agent: AGENT, host: HOST, pass: state.pass });
      if (!d.ok) fail(d.code, `${PROG}: ${d.message}`);
      (state.dispatches ??= []).push(d.entry);
      saveState(state);
      console.log(JSON.stringify(d.entry));
      break;
    }

    case 'record-pass': {
      requireState();
      if (!VERDICT) die('record-pass requires --verdict');
      const state = loadState();
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
      saveState(state);
      console.log(JSON.stringify(state.history[state.history.length - 1]));
      break;
    }

    case 'finish': {
      requireState();
      if (!STATUS) die('finish requires --status');
      const state = loadState();
      state.status = STATUS;
      state.finished = nowIso();
      saveState(state);
      console.log(JSON.stringify({
        status: state.status,
        pass: state.pass,
        history: state.history.length,
        cap_overrides: state.cap_overrides || [],
        ...(state.dispatches ? { dispatches: state.dispatches } : {}),
      }));
      break;
    }

    case 'stats': {
      requireState();
      console.log(JSON.stringify(loadState(), null, 2));
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
