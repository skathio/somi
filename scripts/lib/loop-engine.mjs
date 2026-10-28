// loop-engine.mjs -- the lifecycle handlers of the loop engine: init, resume, pass, finish (the stored-state reads and writes).
// A handler takes a context ({root, env, stateDir}, optional `now` clock) and the parsed arguments and returns
// a result ({out, code, message}, see loop-exit.mjs); it never prints, exits or reads process.env.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyBriefOnly } from './tier-record.mjs';
import { reviewMinFor } from './loop-review.mjs';
import { checkRun } from './run-budget.mjs';
import { loadConfig } from './config-files.mjs';
import { LoopExit, ok, refuse, usageError } from './loop-exit.mjs';
import { applyCapOverride, configVal, firstDefined, resolveInitCap, reresolveCap } from './loop-caps.mjs';
import { loadState, nowIso, requireState, saveState, stateFile } from './loop-state.mjs';

// The effective config; an unreadable or invalid file reads as unconfigured, so the defaults apply.
export function readConfig(root) {
  try {
    return loadConfig(root).config;
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
  fs.mkdirSync(stateDir, { recursive: true });
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
  const config = readConfig(root);
  const plan = loop === 'plan';
  const maxPasses = resolveInitCap(env, config, plan ? 'plan' : 'code', 'max_passes', args.maxPasses);
  const sevFloor = firstDefined(
    args.severity,
    plan ? env.SOMI_PLAN_LOOP_SEVERITY_FLOOR : env.SOMI_CODE_LOOP_SEVERITY_FLOOR,
    configVal(config, [plan ? 'plan_loop' : 'code_loop', 'severity_floor']),
    'Major',
  );
  const diffCap = plan ? 0 : resolveInitCap(env, config, 'code', 'diff_cap_lines', args.diffCap); // plan loops have no diff cap

  let baseline;
  try {
    baseline = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    throw usageError('cannot resolve HEAD');
  }

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
  const run = checkRun(path.dirname(stateDir), args.slug);
  if (run?.over) throw new LoopExit(4, `time-budget-exceeded: ${run.elapsed_minutes} of ${run.max_minutes} minutes used by this run`);
  state.pass = cur + 1;
  saveState(sf, state);
  return ok({ pass: state.pass, max_passes: max, ...withReviewMin(state) });
});

export const finish = guarded(({ stateDir, now = nowIso }, args) => {
  const sf = stateFile(stateDir, args.slug, args.iteration);
  requireState(sf);
  if (!args.status) throw usageError('finish requires --status');
  const state = loadState(sf);
  state.status = args.status;
  state.finished = now();
  saveState(sf, state);
  return ok({
    status: state.status,
    pass: state.pass,
    history: state.history.length,
    cap_overrides: state.cap_overrides || [],
    ...(state.dispatches ? { dispatches: state.dispatches } : {}),
  });
});
