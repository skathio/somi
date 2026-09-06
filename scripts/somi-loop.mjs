// somi-loop.mjs — deterministic state engine for the bounded loops.
//
// Node port of scripts/somi-loop.sh (node-runtime-port, phase 1, iteration 1.1).
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
// `pass`/`check-diff` re-resolve their own cap on every call (F-29 — the documented
// remedy for a fired gate, "adjust the env var and re-run", used to be inert): absent
// an explicit CLI flag or env var THIS invocation, the cap already in force for the
// loop stands unchanged (a `.somi/config.json` edit made mid-loop cannot silently
// reopen an already-resolved gate); see reresolveCap() below. Every cap value, at
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

// Untracked, non-ignored files as synthetic `--numstat` rows (all lines added).
// `git diff` reads the index and the work tree, but a file git has never been
// told about is in neither -- so a brand-new file counts ZERO until someone runs
// `git add`. That made the cap under-measure by the entire size of every new
// file an iteration introduced, silently, in the direction that lets work
// through (F-220: measured 248 against a true 503 on this work item's own 3.3).
// Enumerated separately and merged into the same stream rather than fixed with
// `git add -N`, which would mutate the caller's index as a side effect of a
// read-only query.
function untrackedNumstat(root, pathspec) {
  let listed = '';
  try {
    listed = execFileSync(
      'git',
      ['-C', root, 'ls-files', '--others', '--exclude-standard', '--', ...pathspec],
      { encoding: 'utf8' },
    );
  } catch (e) {
    listed = e.stdout ? e.stdout.toString() : '';
  }
  const rows = [];
  for (const file of listed.split('\n')) {
    if (file === '') continue;
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, file));
    } catch {
      continue; // raced away between listing and reading
    }
    // git calls a blob binary on a NUL in the first 8000 bytes and reports `-`.
    if (buf.subarray(0, 8000).includes(0)) {
      rows.push(`-\t-\t${file}`);
      continue;
    }
    const text = buf.toString('utf8');
    const added = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    rows.push(`${added}\t0\t${file}`);
  }
  return rows.join('\n');
}

// Weighted cumulative diff vs baseline. Out-of-scope lines count double.
// Covers tracked changes, staged changes, AND untracked files (see above) --
// the whole working tree, which is what the cap is meant to bound.
function computeDiff(root, baseline, iterationFiles) {
  const pathspec = ['.', ':(exclude).somi', ':(exclude).claude'];
  let output = '';
  try {
    output = execFileSync(
      'git',
      ['-C', root, 'diff', '--numstat', baseline, '--', ...pathspec],
      { encoding: 'utf8' },
    );
  } catch (e) {
    output = e.stdout ? e.stdout.toString() : '';
  }
  const untracked = untrackedNumstat(root, pathspec);
  if (untracked !== '') output = output === '' ? untracked : `${output}\n${untracked}`;
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

// --- mid-loop cap re-resolution (F-29) --------------------------------------------
// `init` resolves caps once (CLI flag > env var > .somi/config.json > default) and
// freezes them into state -- deliberately, so the diff baseline and pass history stay
// stable across a whole loop. But commands/code-loop.md's Guardrails document a
// remedy for a gate that's wrong for this work item: "the user adjusts the env var
// explicitly and re-runs -- the loop does not 'decide' to widen its own bounds." That
// remedy needs a path that re-reads the override on the SAME subcommand (`pass`,
// `check-diff`), without `init --force` (which discards `pass`/`history`).
//
// `pass` and `check-diff` call reresolveCap() below before their gate check.
// Precedence matches what's documented: CLI flag > env var > .somi/config.json >
// default -- an explicit CLI flag or env var THIS invocation is the only thing that
// can move the cap; absent one, the cap already in force for the loop stands (a
// `.somi/config.json` edit made while a loop is running must NOT silently reopen an
// already-resolved gate). A resolved value that differs from what's stored is
// persisted into `caps` immediately, with an entry appended to a `cap_overrides`
// audit trail (field, from, to, source, after_pass, at) -- the after-the-fact record
// the documented remedy needs, since the env var itself lives only in a shell that
// may since have exited. `cap_overrides` is created lazily, only on the first real
// override, so a loop that never overrides anything keeps exactly today's state
// shape (no golden-fixture regeneration forced by this fix). `baseline_sha`,
// `started`, `pass`, and `history` are never touched here.
//
// Every value that reaches `Number()` on this path is user input (a CLI flag, an env
// var, or a config value) and is validated before use: `Number()` on a malformed
// string (`"1,000"`, `"unlimited"`) yields NaN, which is false against BOTH gate
// comparisons (`cur + 1 > max`, `weighted > cap`) -- silently switching the gate off
// -- and `JSON.stringify` then persists that NaN as `null`, which the next bare call
// falls through past (via `firstDefined`) to re-arm at the default, with no
// `cap_overrides` entry recording the reversion. `validateCap()` rejects rather than
// coerces, so a malformed value dies loudly instead of disabling a gate.
const CAP_ENV = {
  code: { max_passes: 'SOMI_CODE_LOOP_MAX_PASSES', diff_cap_lines: 'SOMI_CODE_LOOP_DIFF_CAP' },
  plan: { max_passes: 'SOMI_PLAN_LOOP_MAX_PASSES' },
};
const CAP_FLAG = { max_passes: '--max-passes', diff_cap_lines: '--diff-cap' };
const CAP_CONFIG_SECTION = { code: 'code_loop', plan: 'plan_loop' };
const CAP_DEFAULT = { max_passes: 3, diff_cap_lines: 400 };

// Rejects a malformed cap value rather than letting `Number()` coerce it to NaN.
// `label` names the source in the error so `die()`'s message points at what to fix
// (a specific flag, env var, or the generic field name at `init`, where the value
// may have come from any of CLI/env/config).
function validateCap(raw, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    die(`${label}: expected a non-negative integer, got "${raw}"`);
  }
  return n;
}

// Resolves one cap at `init`, reading the same CAP_ENV / CAP_CONFIG_SECTION /
// CAP_DEFAULT tables reresolveCap() uses, so the two paths cannot silently diverge
// on an env var name, a config key, or a default value.
function resolveInitCap(config, family, field, argVal) {
  if (field === 'diff_cap_lines' && family === 'plan') return 0; // plan loops have no diff cap
  const envVar = CAP_ENV[family][field];
  const fromConfig = configVal(config, [CAP_CONFIG_SECTION[family], field]);
  const picked = firstDefined(argVal, process.env[envVar], fromConfig, CAP_DEFAULT[field]);
  return validateCap(picked, field);
}

function reresolveCap(state, field, argVal) {
  const family = state.loop === 'plan' ? 'plan' : 'code';
  if (field === 'diff_cap_lines' && family === 'plan') {
    return { resolved: 0, override: null }; // plan loops have no diff cap (see `init`)
  }
  const envVar = CAP_ENV[family][field];
  const stored = state.caps[field];
  const explicit = firstDefined(argVal, process.env[envVar]);
  const isCli = argVal !== undefined && argVal !== '';
  const resolved = explicit === undefined
    ? stored
    : validateCap(explicit, isCli ? CAP_FLAG[field] : envVar);
  let override = null;
  if (explicit !== undefined && resolved !== stored) {
    override = {
      field,
      from: stored,
      to: resolved,
      source: isCli ? 'cli' : 'env',
      after_pass: state.pass,
      at: nowIso(),
    };
  }
  return { resolved, override };
}

// Mutates `state.caps[field]` and appends the audit entry. Caller still owns calling
// saveState() -- kept separate so `pass`/`check-diff` persist the override BEFORE
// their gate check can throw, not only on the success path.
function applyCapOverride(state, override) {
  state.caps[override.field] = override.to;
  if (!Array.isArray(state.cap_overrides)) state.cap_overrides = [];
  state.cap_overrides.push(override);
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

      // Cap resolution: CLI > env > config > default (per loop type), through the
      // same CAP_ENV / CAP_CONFIG_SECTION / CAP_DEFAULT tables reresolveCap() uses,
      // and validated the same way -- a malformed value dies here rather than
      // silently resolving to a fail-open NaN/null.
      const config = readConfig(root);
      let maxPasses;
      let diffCap;
      let sevFloor;
      if (LOOP === 'plan') {
        maxPasses = resolveInitCap(config, 'plan', 'max_passes', ARG_MAX_PASSES);
        sevFloor = firstDefined(ARG_SEVERITY, process.env.SOMI_PLAN_LOOP_SEVERITY_FLOOR, configVal(config, ['plan_loop', 'severity_floor']));
        diffCap = 0; // plan loops have no diff cap
      } else {
        maxPasses = resolveInitCap(config, 'code', 'max_passes', ARG_MAX_PASSES);
        sevFloor = firstDefined(ARG_SEVERITY, process.env.SOMI_CODE_LOOP_SEVERITY_FLOOR, configVal(config, ['code_loop', 'severity_floor']));
        diffCap = resolveInitCap(config, 'code', 'diff_cap_lines', ARG_DIFF_CAP);
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
      const { resolved: max, override } = reresolveCap(state, 'max_passes', ARG_MAX_PASSES);
      if (override) {
        applyCapOverride(state, override);
        saveState(state); // persist the raise even if the gate below still fails
      }
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
      const { resolved: cap, override } = reresolveCap(state, 'diff_cap_lines', ARG_DIFF_CAP);
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
      console.log(JSON.stringify({
        status: state.status,
        pass: state.pass,
        history: state.history.length,
        cap_overrides: state.cap_overrides || [],
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
  if (e instanceof ExitSignal) {
    process.exitCode = e.code;
  } else {
    throw e;
  }
}
