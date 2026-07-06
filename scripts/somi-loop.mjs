// somi-loop.mjs — deterministic state engine for the bounded loops.
//
// Node port of scripts/somi-loop.sh (node-runtime-port, phase 1, iteration 1.1).
// Zero-dependency: stdlib only (node:fs, node:path, node:child_process). No jq,
// no bash. Behavior-preserving — exit codes and stdout JSON shapes are frozen
// and reproduced exactly; see the bash original's header comment for the full
// rationale (state survives session death, caps are SoMi's central safety
// claim, etc).
//
// State: .claude/somi-state/loop/<slug>[.<iteration>].json under the project
// root (project-local, gitignored by SoMi's conventions). Never committed.
//
// Cap precedence (matches the gate tables): CLI flag > env var > .somi/config.json
// > default. Diff measurement EXCLUDES .somi/ and .claude/ — artifact churn
// (progress/diary updates every pass) must not eat the code diff budget.
//
// Exit codes (callers branch on these — do not repurpose):
//   0  ok
//   2  max-passes-exceeded   (`pass` would exceed the cap)
//   3  diff-cap-exceeded     (`check-diff`: weighted lines over the cap;
//                             out-of-scope lines count double)
//   64 usage / environment error
//
// Subcommands: init | resume | pass | check-diff | record-pass | finish | stats
// (see scripts/somi-loop.sh for the full per-subcommand doc — unchanged here).
//
// Tested by tests/scripts/run.sh (wired into scripts/validate.sh / CI).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROG = 'somi-loop';

// Thrown to unwind to the top-level handler, which sets process.exitCode and
// lets Node exit naturally — avoids process.exit()'s risk of truncating
// buffered stdout/stderr writes on a pipe.
class ExitSignal extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function die(msg) {
  process.stderr.write(`${PROG}: ${msg}\n`);
  throw new ExitSignal(64);
}

function fail(code, msg) {
  process.stderr.write(`${msg}\n`);
  throw new ExitSignal(code);
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

function readConfig(root) {
  const cfgPath = path.join(root, '.somi', 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return {};
  }
}

function configVal(config, keys) {
  let cur = config;
  for (const k of keys) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[k];
  }
  return cur === null ? undefined : cur;
}

// Mirrors bash's `${a:-${b:-$c}}` — first arg that is neither unset nor an
// empty string wins (a numeric 0 counts as "set", matching bash treating the
// non-empty string "0" as set).
function firstDefined(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v === '') continue;
    return v;
  }
  return undefined;
}

function nowIso() {
  // `date -u +%Y-%m-%dT%H:%M:%SZ` — no milliseconds.
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Weighted cumulative diff vs baseline. Out-of-scope lines count double.
function computeDiff(root, baseline, iterationFiles) {
  let output = '';
  try {
    output = execFileSync(
      'git',
      ['-C', root, 'diff', '--numstat', baseline, '--', '.', ':(exclude).somi', ':(exclude).claude'],
      { encoding: 'utf8' },
    );
  } catch (e) {
    output = e.stdout ? e.stdout.toString() : '';
  }
  let total = 0;
  let weighted = 0;
  const outOfScope = [];
  for (const line of output.split('\n')) {
    if (line === '') continue;
    const parts = line.split('\t');
    let added = parts[0];
    let deleted = parts[1];
    const file = parts.slice(2).join('\t');
    if (!file) continue;
    added = added === '-' ? 0 : Number(added); // binary
    deleted = deleted === '-' ? 0 : Number(deleted);
    const lines = added + deleted;
    total += lines;
    let inScope = false;
    for (const entry of iterationFiles) {
      if (!entry) continue;
      if (file === entry || (entry.endsWith('/') && file.startsWith(entry))) {
        inScope = true;
        break;
      }
    }
    if (inScope) {
      weighted += lines;
    } else {
      weighted += 2 * lines;
      outOfScope.push(file);
    }
  }
  return { total, weighted, outOfScope };
}

function main() {
  requireGit();

  const root = projectRoot();
  const STATE_DIR = process.env.SOMI_LOOP_STATE_DIR || path.join(root, '.claude', 'somi-state', 'loop');

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
      case '--force': FORCE = true; rest = rest.slice(1); break;
      default: die(`unknown argument: ${a}`);
    }
  }

  if (!CMD) die('usage: somi-loop.mjs <init|resume|pass|check-diff|record-pass|finish|stats> --slug <slug> …');
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

  switch (CMD) {
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

      // Cap resolution: CLI > env > config > default (per loop type).
      const config = readConfig(root);
      let maxPasses;
      let diffCap;
      let sevFloor;
      if (LOOP === 'plan') {
        maxPasses = firstDefined(ARG_MAX_PASSES, process.env.SOMI_PLAN_LOOP_MAX_PASSES, configVal(config, ['plan_loop', 'max_passes']));
        sevFloor = firstDefined(ARG_SEVERITY, process.env.SOMI_PLAN_LOOP_SEVERITY_FLOOR, configVal(config, ['plan_loop', 'severity_floor']));
        diffCap = 0; // plan loops have no diff cap
      } else {
        maxPasses = firstDefined(ARG_MAX_PASSES, process.env.SOMI_CODE_LOOP_MAX_PASSES, configVal(config, ['code_loop', 'max_passes']));
        sevFloor = firstDefined(ARG_SEVERITY, process.env.SOMI_CODE_LOOP_SEVERITY_FLOOR, configVal(config, ['code_loop', 'severity_floor']));
        diffCap = firstDefined(ARG_DIFF_CAP, process.env.SOMI_CODE_LOOP_DIFF_CAP, configVal(config, ['code_loop', 'diff_cap_lines']));
      }
      maxPasses = Number(firstDefined(maxPasses, 3));
      sevFloor = firstDefined(sevFloor, 'Major');
      diffCap = Number(firstDefined(diffCap, 400));

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
      saveState(state);
      console.log(JSON.stringify({ baseline_sha: state.baseline_sha, caps: state.caps, state_file: SF }));
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
      const max = state.caps.max_passes;
      const cur = state.pass;
      if (cur + 1 > max) {
        fail(2, `max-passes-exceeded: pass ${cur + 1} > cap ${max}`);
      }
      state.pass = cur + 1;
      saveState(state);
      console.log(JSON.stringify({ pass: state.pass, max_passes: max }));
      break;
    }

    case 'check-diff': {
      requireState();
      const state = loadState();
      const { total, weighted, outOfScope } = computeDiff(root, state.baseline_sha, state.iteration_files);
      const cap = state.caps.diff_cap_lines;
      console.log(JSON.stringify({ diff_lines: total, weighted_lines: weighted, cap, out_of_scope: outOfScope }));
      if (cap > 0 && weighted > cap) {
        fail(3, `diff-cap-exceeded: weighted ${weighted} > cap ${cap} (out-of-scope counts double)`);
      }
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
      console.log(JSON.stringify({ status: state.status, pass: state.pass, history: state.history.length }));
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
  if (e instanceof ExitSignal) {
    process.exitCode = e.code;
  } else {
    throw e;
  }
}
