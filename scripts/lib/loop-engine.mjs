// loop-engine.mjs -- the handlers of the loop engine: the lifecycle (init, resume, pass, finish), the measuring
// ones (check-diff, review-scope) and the recording ones (run-start, record-dispatch, record-pass).
// A handler takes a context ({root, env, stateDir, installRoot}, optional `now` clock) and the parsed arguments
// and returns a result ({out, code, message}, see loop-exit.mjs); it never prints or exits, and it reads the
// environment only from ctx.env (the one inheritance of the process env is the git subprocess in loop-review.mjs's snapshotTree).

import fs from 'node:fs';
import path from 'node:path';
import { verifyBriefOnly } from './tier-record.mjs';
import { REVIEW_SCOPES, headCommit, reviewMinFor, reviewScope as scopeOf, snapshotTree } from './loop-review.mjs';
import { computeDiff } from './loop-diff.mjs';
import { dispatchEntry } from './loop-dispatch.mjs';
import { checkRun, startRun } from './run-budget.mjs';
import { loadConfig } from './config-files.mjs';
import { LoopExit, PROG, ok, refuse, usageError } from './loop-exit.mjs';
import { applyCapOverride, configVal, firstDefined, resolveInitCap, reresolveCap, validateCap } from './loop-caps.mjs';
import { loadState, nowIso, requireState, saveState, stateFile } from './loop-state.mjs';
import { SEVERITIES } from './findings-ledger.mjs';

// The effective config; an unreadable or invalid file reads as unconfigured, so the defaults apply.
export function readConfig(root, env) {
  try {
    return loadConfig(root, env).config;
  } catch {
    return {};
  }
}

// A thrown LoopExit reaches the caller as the result it stands for.
function guarded(body) {
  return (ctx, args) => {
    try {
      return body(ctx, args);
    } catch (e) {
      if (e instanceof LoopExit) return refuse(e.code, e.message);
      throw e;
    }
  };
}

const withReviewMin = (state) => (state.review_min ? { review_min: state.review_min } : {});

export const init = guarded(({ env, root, stateDir, now = nowIso }, args) => {
  const { slug, loop, iteration, force } = args;
  const sf = stateFile(stateDir, slug, iteration);
  if (fs.existsSync(sf) && !force) {
    let status;
    try {
      status = loadState(sf).status;
    } catch {
      status = undefined;
    }
    if (status === 'running') {
      throw usageError(`loop state already running at ${sf} — use 'resume' to continue it, or 'init --force' to discard`);
    }
  }

  // A brief-only work item (a plan directory with no phases/) exists only for the sized, human-
  // approved small tier of /ship-loop: refuse it without the tier record's approval stamp.
  const planDir = path.join(root, '.somi', 'plans', slug);
  if (loop === 'code' && fs.existsSync(planDir) && !fs.existsSync(path.join(planDir, 'phases'))) {
    const v = verifyBriefOnly(root, slug);
    if (!v.ok) throw usageError(`brief-only work item refused: ${v.reason}; use /plan or /ship-loop`);
  }

  // Cap resolution: CLI > env > config > default, validated (see loop-caps.mjs).
  const config = readConfig(root, env);
  const plan = loop === 'plan';
  const maxPasses = resolveInitCap(env, config, plan ? 'plan' : 'code', 'max_passes', args.maxPasses);
  const sevFloor = firstDefined(
    args.severity,
    plan ? env.SOMI_PLAN_LOOP_SEVERITY_FLOOR : env.SOMI_CODE_LOOP_SEVERITY_FLOOR,
    configVal(config, [plan ? 'plan_loop' : 'code_loop', 'severity_floor']),
    'Major',
  );
  if (!SEVERITIES.includes(sevFloor)) throw usageError(`severity_floor: ${sevFloor} must be one of ${SEVERITIES.join('|')}`);
  const diffCap = plan ? 0 : resolveInitCap(env, config, 'code', 'diff_cap_lines', args.diffCap); // plan loops have no diff cap

  const baseline = headCommit(root);

  const state = {
    slug,
    loop,
    iteration,
    baseline_sha: baseline,
    started: now(),
    status: 'running',
    caps: { max_passes: maxPasses, diff_cap_lines: diffCap, severity_floor: sevFloor },
    iteration_files: args.files.split(' ').filter((s) => s.length > 0),
    pass: 0,
    history: [],
  };
  if (loop === 'code') state.review_min = reviewMinFor(root, slug) ?? undefined; // undefined: not serialised
  fs.mkdirSync(stateDir, { recursive: true }); // only now: a refused init leaves no directory behind
  saveState(sf, state);
  return ok({ baseline_sha: state.baseline_sha, caps: state.caps, state_file: sf, ...withReviewMin(state) });
});

export const resume = guarded(({ stateDir }, { slug, iteration }) => {
  const sf = stateFile(stateDir, slug, iteration);
  requireState(sf);
  return ok(loadState(sf));
});

export const pass = guarded(({ env, stateDir, now = nowIso }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  const state = loadState(sf);
  const { resolved: max, override } = reresolveCap(env, state, 'max_passes', args.maxPasses, now());
  if (override) {
    applyCapOverride(state, override);
    saveState(sf, state); // persist the raise even if the gate below still fails
  }
  const cur = state.pass;
  if (cur + 1 > max) throw new LoopExit(2, `max-passes-exceeded: pass ${cur + 1} > cap ${max}`);
  const run = checkRun(path.dirname(stateDir), args.slug, Date.parse(now()));
  if (run?.over) throw new LoopExit(4, `time-budget-exceeded: ${run.elapsed_minutes} of ${run.max_minutes} minutes used by this run`);
  state.pass = cur + 1;
  saveState(sf, state);
  return ok({ pass: state.pass, max_passes: max, ...withReviewMin(state) });
});

// The reasons a stopped loop is closed with (`stopped-<reason>`): the code loop's documented stops, plus the time budget `open` reports.
export const STOP_REASONS = Object.freeze(['max-passes-exceeded', 'diff-cap-exceeded', 'scope-expansion', 'circuit-breaker', 'user-stop', 'time-budget']);
export const documentedStatus = (s) => s === 'done' || (typeof s === 'string' && s.startsWith('stopped-') && STOP_REASONS.includes(s.slice(8)));

// Ends a running loop: the status and the time it ended, and the summary `finish` prints. Shared by `finish` and the `close` step.
// A loop that is already over is refused, so a second finish cannot rewrite how the first ended.
export function endLoop(state, status, at) {
  if (state.status !== 'running') throw usageError(`the loop is not running (status ${JSON.stringify(String(state.status).slice(0, 40))}); it cannot be finished again`);
  state.status = status;
  state.finished = at;
  return {
    status,
    pass: state.pass,
    history: state.history.length,
    cap_overrides: state.cap_overrides || [],
    ...(state.dispatches ? { dispatches: state.dispatches } : {}),
  };
}

export const finish = guarded(({ stateDir, now = nowIso }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  if (!args.status) throw usageError('finish requires --status');
  const state = loadState(sf);
  const summary = endLoop(state, args.status, now());
  saveState(sf, state);
  return ok(summary);
});

export const runStart = guarded(({ env, root, stateDir }, args) => {
  const raw = firstDefined(args.maxMinutes, env.SOMI_SHIP_LOOP_MAX_MINUTES, configVal(readConfig(root, env), ['ship_loop', 'max_minutes']));
  const max = raw === undefined ? null : validateCap(raw, 'max_minutes');
  if (max === 0) throw usageError('max_minutes: 0 would disable the budget; leave it unset instead');
  return ok(startRun(path.dirname(stateDir), args.slug, max, { force: args.force }));
});

// Over the cap it is a refusal that still carries its JSON: the CLI prints stdout, then the stderr line.
export const checkDiff = guarded(({ env, root, stateDir, now = nowIso }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  const state = loadState(sf);
  const { resolved: cap, override } = reresolveCap(env, state, 'diff_cap_lines', args.diffCap, now());
  if (override) {
    applyCapOverride(state, override);
    saveState(sf, state); // persist the raise even if the gate below still fails
  }
  const { total, weighted, outOfScope } = computeDiff(root, state.baseline_sha, state.iteration_files);
  const out = { diff_lines: total, weighted_lines: weighted, cap, out_of_scope: outOfScope };
  if (cap > 0 && weighted > cap) return refuse(3, `diff-cap-exceeded: weighted ${weighted} > cap ${cap} (out-of-scope counts double)`, out);
  return ok(out);
});

export const reviewScope = guarded(({ env, root, stateDir }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  const state = loadState(sf);
  const setting = firstDefined(env.SOMI_CODE_LOOP_REVIEW_SCOPE, configVal(readConfig(root, env), ['code_loop', 'review_scope']), 'delta');
  if (!REVIEW_SCOPES.includes(setting)) throw usageError(`review scope must be one of ${REVIEW_SCOPES.join('|')}, got ${JSON.stringify(setting)}`);
  return ok({ ...scopeOf(root, state, setting), ...withReviewMin(state) });
});

export const recordDispatch = guarded(({ root, installRoot, stateDir }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  if (!args.agent) throw usageError('record-dispatch requires --agent');
  const state = loadState(sf);
  const d = dispatchEntry({ root, installRoot, agent: args.agent, host: args.host, pass: state.pass });
  if (!d.ok) return refuse(d.code, `${PROG}: ${d.message}`);
  (state.dispatches ??= []).push(d.entry);
  saveState(sf, state);
  return ok(d.entry);
});

// A pass entry the step reads back: a short verdict without control characters, counts that are numbers (null: unrecorded).
export const entryOk = (h) => typeof h.verdict === 'string' && h.verdict.length <= 60 && !/\p{Cc}/u.test(h.verdict) && [h.blockers, h.majors].every((n) => n == null || (Number.isFinite(n) && n >= 0));
// The history entry of the pass in progress: the verdict and counts as given, the cumulative diff and the tree reviewed
// (the next pass's delta starts there). Shared by `record-pass` and the composite steps, which store it under their cursor.
export function passEntry(root, state, args, at) {
  const { total } = computeDiff(root, state.baseline_sha, state.iteration_files);
  const entry = {
    pass: state.pass,
    verdict: args.verdict,
    blockers: Number(args.blockers),
    majors: Number(args.majors),
    diff_lines: total,
    tree: snapshotTree(root) ?? undefined,
    at,
  };
  if (!entryOk(entry)) throw usageError('verdict must be at most 60 characters without control characters, and --blockers and --majors non-negative numbers');
  return entry;
}

export const recordPass = guarded(({ root, stateDir, now = nowIso }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  if (!args.verdict) throw usageError('record-pass requires --verdict');
  const state = loadState(sf);
  const entry = passEntry(root, state, args, now());
  state.history.push(entry);
  saveState(sf, state);
  return ok(entry);
});
