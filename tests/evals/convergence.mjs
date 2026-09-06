#!/usr/bin/env node
// tests/evals/convergence.mjs -- the convergence gate DRIVER (phase 3, D1-D5, R2/R3). A new
// entrypoint, deliberately separate from run.mjs: no fixture-diff scoring, no judge, no
// per-criterion verdicts -- folding this into run.mjs's CLI would blur both (phases/03, 3.3).
//
// Assembles 3.1's extractor (lib/convergence.mjs) and 3.2's rank test (lib/mann-whitney.mjs) into
// a gate that drives /code-loop against task02-code (D9) via lib/install.mjs's installSomi/
// invokeCommand/preflight, UNCHANGED -- no new subprocess pattern. The CLI section at the bottom
// (3.4 -- --source/--fixture/--runs/--merge/--certify, mirroring run.mjs's own shape) is what
// makes this runnable; everything above it is 3.1-3.3's already-reviewed module.
//
// This is 3.3's preserved pass-2 module (see the split banner above iteration 3.3 in
// phases/03-convergence-gating.md), carved back in across three sub-iterations rather than
// re-implemented: pass 2 landed all six acceptance points at 861 lines against a cap already
// raised once to 510, and was split along the module's own section divider. **3.3a (done)**
// carved classifyDraw/fillArm/safeCleanup -- points 4 and 5. **3.3b (done)** added compareArms/
// estimatePower/runComparison -- points 1, 2, 3 and 6. **This carve (3.3c)** adds
// loopShardPath/resumeArm/prepareDrawDir/startDraw/drawArmForSha -- the resume/namespace layer
// and the live-draw mechanism, the only part that spends quota or touches disk. The module is
// complete after this carve; nothing is left behind.
//
// Three traps this file exists specifically to not reintroduce (see phases/03-convergence-gating.md
// iteration 3.3's revision history for the full reasoning):
//  1. capBreached() is three-way. `if (!capBreached(o))` reads a `running` loop's null as
//     "not breached" and silently counts it -- classifyDraw() below never does that comparison.
//  2. Excluding a `running` draw is INFORMATIVE censoring (slow -> more passes -> the arm that
//     regressed), so "draw until the arm holds N_PER_ARM usable draws" cancels the detector it
//     exists to serve. fillArm() below never substitutes a fresh draw for a censored one -- it
//     waits on the SAME draw (bounded), and gives up on the whole arm rather than topping it back
//     up if the wait budget runs out.
//  3. Every check this module's OWN test suite owns can bound a false ACCEPT; a gate that can
//     NEVER accept (`verdict = 'inconclusive'` unconditionally) is a different failure direction
//     that none of points 1/2/4/5 catch (F-221, Blocker). compareArms()'s verdict logic below is
//     not itself different because of this -- it was already correct -- but the healthy-input
//     case's own assertion (eval-runner.sh) had to stop being a membership check to bind it.

import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installSomi, invokeCommand, preflight } from './lib/install.mjs';
import { capBreached, passesToApprove, terminalVerdict, terminalOutcome } from './lib/convergence.mjs';
import { mannWhitneyU, DEFAULT_RESAMPLES } from './lib/mann-whitney.mjs';
import { shardDir, resolveSource, fixtureFor } from './run.mjs';

// D2: the floor at which an inconclusive result reads as inconclusive rather than an accepted
// pass. Pinned as a literal -- acceptance point 4's first half asserts this exact value,
// independent of any draw outcome (nothing else in this module is n-agnostic by accident).
export const N_PER_ARM = 15;
export const ALPHA = 0.05; // D5.
// The +1-pass shift D2's own power analysis is sized to detect -- the equivalence boundary
// no-regression must show the effect's upper confidence bound excludes.
export const REGRESSION_SHIFT = 1;
// Each retry is a FULL /code-loop re-invocation (resumed via commands/code-loop.md's own resume
// check, up to invokeCommand's 30-minute subprocess timeout) -- this bounds cost, not polling
// frequency. 2 gives a `running` draw two more full attempts to reach a terminal status before
// the arm gives up on that slot (F-191/F-194's wait/poll cap).
// **Not derived from a measured distribution** (code-loop pass 2 review, question 5) -- there is
// no historical record of how many /code-loop resumes a slow real loop needs, so this is a
// judgment-call round number in the same category as DEFAULT_MAX_REPLACEMENTS below, not a
// figure computed the way D2's own N=15 was. It is the parameter that decides how often a
// slow-but-terminating draw becomes `insufficient-draws` -- worth re-deriving once phase 4
// produces real wall-clock data, not before.
export const DEFAULT_MAX_WAIT_ATTEMPTS = 2;
// Malformed shapes are uncorrelated with cost and may be replaced (F-194), but unboundedly is a
// silent infinite loop waiting to happen -- generous enough to absorb a rare flake, low enough
// that a persistent one (a real harness bug) still hard-fails within one arm's draw.
export const DEFAULT_MAX_REPLACEMENTS = 5;

export const TASK_ID = 'loop-code-loop';
// The only fixture shaped for a code+review loop (D9) -- its own committed plan tree already
// declares this slug/iteration (tests/evals/fixtures/task02-code/_somi/plans/expired-token/).
export const LOOP_SLUG = 'expired-token';
export const LOOP_ITERATION = '1.1';

// ---------------------------------------------------------------------------------------------
// Convergence shard namespace -- OWN directory, OWN schema (F-225, code-loop pass 2 review).
// The shipped shard silently reused run.mjs's SCHEMA_VERSION number space under `schema: 1`,
// unexplained -- an accident, not a decision (answering the pass-1 review's question 2: no, it
// was not deliberate). Namespacing under shardDir(sha)/convergence/ removes the coincidence
// entirely rather than teaching mergeShards() a second exception: run.mjs's `ls`-based listing
// never recurses into a subdirectory, so these files are structurally invisible to the task
// corpus's mergeShards()/buildResult() -- verified below, not merely reasoned about. This is the
// namespace-split option the review offered (over: stamp SCHEMA_VERSION, teach mergeShards() to
// skip unrecognised taskIds, route every read through readShard()) -- chosen because it removes
// the collision rather than adding a second component that has to know about it.
//
// Stays 1, not bumped, when `run.verdict` was added (phase 4, F-267) and widened to `run.terminal`
// (F-268): both are backward-compatible fields, not shape changes -- no reader keys off either,
// and the three real shards on disk before either field existed remain valid records of the same
// schema.
//
// The trade, named honestly rather than as "buys nothing" (F-269, code-loop pass 3 review): a
// bump PAIRED WITH a widened read gate WOULD buy one real thing -- unambiguous shape
// disambiguation via the version field itself. Not bumping trades that for an equally reliable
// disambiguator, key presence (`'verdict' in rec.run`), matching `run.mjs`'s own "absent, and
// recorded" convention, with none of a bump's risk: `readLoopShard()`'s schema gate below is a
// strict `===` match, so a bump the read path didn't also widen in lockstep would make the three
// quota-paid shards unreadable -- the exact outcome constraint 1 forbids.
//
// Reader contract (4.2's report is the first reader of either field): THREE states, not two --
// (1) key ABSENT: pre-F-267 legacy shape, exactly the three quota-paid shards F-266 concerns,
// never a malformed shard; (2) `null`: the key is present but undetermined at write time, still
// not a verdict; (3) PRESENT: a real value from a completed terminal entry. Collapsing (1)/(2) is
// wrong -- (1) is silence from before this diagnostic existed, (2) is it actively reporting it
// could not determine an answer.
export const LOOP_SCHEMA_VERSION = 1;

function loopShardDir(sha) {
  return join(shardDir(sha), 'convergence');
}

export function loopShardPath(sha, taskId, index) {
  return join(loopShardDir(sha), `${taskId}-${String(index).padStart(3, '0')}.json`);
}

function loopCompletedIndices(sha, taskId, runs) {
  const out = new Set();
  for (let i = 0; i < runs; i++) if (existsSync(loopShardPath(sha, taskId, i))) out.add(i);
  return out;
}

/**
 * Schema-guarded shard read for THIS module's own namespace (mirrors run.mjs's readShard(), the
 * F-131 discipline: a shard is either usable or absent, never a thrown SyntaxError out of a live
 * draw). `null` for anything unreadable OR off-schema -- every caller must treat that exactly
 * like an absent shard.
 */
function readLoopShard(path) {
  let rec;
  try { rec = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  return rec?.schema === LOOP_SCHEMA_VERSION ? rec : null;
}

/**
 * Read back whichever shards already exist for one arm's SHA (F-230, code-loop pass 2 review):
 * `loopCompletedIndices()` returns a SET of indices whose files EXIST, not a promise of a
 * contiguous prefix -- with shards {0,2} present, `done.length` as the next write index would
 * silently OVERWRITE shard 2 and never write 1, and the arm's values would stop corresponding to
 * their indices. The next write targets the first genuinely MISSING slot instead, self-healing
 * the gap rather than perpetuating it. A shard that exists but fails its own schema/read guard
 * (readLoopShard() -> null) is excluded from `resume` like any absent shard, but its slot still
 * counts as occupied for `nextIndex` -- a corrupted shard is not silently overwritten either.
 */
export function resumeArm(sha, taskId, n) {
  const done = [...loopCompletedIndices(sha, taskId, n)].sort((a, b) => a - b);
  const resume = [];
  for (const i of done) {
    const rec = readLoopShard(loopShardPath(sha, taskId, i));
    if (rec) resume.push(rec.run.pass);
  }
  let nextIndex = 0;
  while (done.includes(nextIndex)) nextIndex++;
  return { resume, nextIndex, occupied: new Set(done) };
}

/**
 * Classify one read-back loop-state draw (point 5, closing F-182/F-184). Three non-terminal-ok
 * outcomes distinguished by CAUSE, not merely by capBreached()'s shared `null`:
 *   - 'breach'    capBreached() === true -- fails the WHOLE comparison outright (R3), never just
 *                 this draw.
 *   - 'done'      capBreached() === false AND passesToApprove() is a real number -- a usable draw.
 *   - 'running'   capBreached() === null because the loop has neither converged nor breached yet
 *                 -- a timing artifact CORRELATED with cost (slow loops are the ones still
 *                 running). Never counted, never treated as an error.
 *   - 'malformed' capBreached() === null for any other reason (an unrecognised shape), OR
 *                 status === 'done' with an unreadable `pass` field -- UNCORRELATED with cost,
 *                 and a hard-error condition this driver surfaces loudly (fillArm() below), not a
 *                 silently dropped draw.
 * `capBreached()`'s own docstring is explicit that this distinction belongs at the driver, not as
 * a third export from lib/convergence.mjs -- this is that call site. capBreached() also folds in
 * commands/code-loop.md's documented `stopped-<reason>` write form (F-235), so classifyDraw()
 * inherits that fix without a second match here.
 */
export function classifyDraw(loopStateJson) {
  const breach = capBreached(loopStateJson);
  if (breach === true) return { kind: 'breach' };
  if (breach === false) {
    const pass = passesToApprove(loopStateJson);
    return pass === null ? { kind: 'malformed' } : { kind: 'done', pass };
  }
  if (loopStateJson !== null && typeof loopStateJson === 'object' && loopStateJson.status === 'running') {
    return { kind: 'running' };
  }
  return { kind: 'malformed' };
}

/** Best-effort cleanup of one draw handle's workDir (F-226): never let a cleanup FAILURE lose an
 * arm already collected -- swallow, don't propagate. */
function safeCleanup(draw) {
  try { draw.cleanup?.(); } catch { /* best-effort; the arm already collected matters more */ }
}

/**
 * Fill one arm to `n` usable convergence-cost draws, applying the settled remedy split by cause
 * (F-191/F-194): a `running` draw is waited on and RE-READ from the SAME handle (never
 * substituted -- substituting is exactly the bug that cancels this arm's censoring signal); a
 * `malformed` draw is reported loudly and REPLACED with a fresh handle (safe -- uncorrelated with
 * cost). A `breach` on any handle fails the whole comparison outright (R3), independent of
 * anything already collected. If the wait budget on one draw is exhausted, filling STOPS rather
 * than substituting a replacement for it -- the arm is returned short, which the caller (below)
 * turns into `insufficient-draws`, not a silently topped-up mean. Every handle this loop is done
 * with (pushed, breached, wait-exhausted, or discarded as malformed) is cleaned up before the
 * function moves on (F-226) -- the only handle NEVER cleaned up mid-arm is one still being
 * retried, since retry() reuses the SAME workDir.
 *
 * @param {() => {read: () => *, retry: () => void, cleanup?: () => void}} newDraw  starts one
 *   fresh draw and returns a handle: `read()` re-reads that SAME draw's current loop-state (no
 *   side effect); `retry()` re-invokes the underlying command against the SAME workDir
 *   (commands/code-loop.md's own resume check picks up where it left off -- this IS the "wait",
 *   not a bare sleep-and-poll); `cleanup()` (optional) removes the handle's workDir.
 * @param {object} [opts]
 * @returns {{breach: boolean, arm: number[], stillRunning: number, replaced: number, waitExhausted: boolean}}
 */
export function fillArm(newDraw, opts = {}) {
  const n = opts.n ?? N_PER_ARM;
  const maxWaitAttempts = opts.maxWaitAttempts ?? DEFAULT_MAX_WAIT_ATTEMPTS;
  const maxReplacements = opts.maxReplacements ?? DEFAULT_MAX_REPLACEMENTS;
  const report = opts.report ?? ((msg) => process.stderr.write(msg + '\n'));

  const arm = [...(opts.resume ?? [])];
  let stillRunning = 0;
  let replaced = 0;
  while (arm.length < n) {
    const draw = newDraw();
    let state = draw.read();
    let waitAttempts = 0;
    for (;;) {
      const c = classifyDraw(state);
      if (c.kind === 'breach') {
        safeCleanup(draw);
        return { breach: true, arm, stillRunning, replaced, waitExhausted: false };
      }
      if (c.kind === 'done') {
        arm.push(c.pass);
        opts.onDraw?.(c.pass);
        safeCleanup(draw);
        break;
      }
      if (c.kind === 'running') {
        stillRunning++;
        waitAttempts++;
        if (waitAttempts > maxWaitAttempts) {
          safeCleanup(draw);
          return { breach: false, arm, stillRunning, replaced, waitExhausted: true };
        }
        draw.retry();
        state = draw.read();
        continue;
      }
      // malformed -- count, clean up, and check the replacement budget BEFORE reporting (F-232:
      // reporting first could print "replacement 6 of 5 allowed" on the very call that then
      // throws for exceeding it).
      replaced++;
      safeCleanup(draw);
      if (replaced > maxReplacements) {
        throw new Error(`convergence: ${replaced} malformed loop-state draws for one arm -- treating as a harness fault, not sampling noise`);
      }
      report(`convergence: malformed loop-state shape on draw ${arm.length + 1}/${n} -- discarding and redrawing (replacement ${replaced} of ${maxReplacements} allowed)`);
      break; // this handle discarded; outer while retries the same still-open slot with a fresh newDraw()
    }
  }
  return { breach: false, arm, stillRunning, replaced, waitExhausted: false };
}

/**
 * Live Monte-Carlo estimate of this procedure's own power (F-223, code-loop pass 2 review): run
 * `trials` synthetic UNSHIFTED pairs of size `n` (each arm drawn fresh via `drawOne`, with
 * replacement) through compareArms() and report the fraction verdicted `no-regression`. By the
 * equivalence check's own shift-symmetry (testing baseline vs candidateShifted on an UNSHIFTED
 * pair IS a test for detecting a real `shift`-sized difference), this is the same quantity D2's
 * power table reports for the primary test -- confirmed at n=15 against the historical population
 * (measured 70.8% vs D2's predicted 71.6% at T=600/R=3000, pass-1 review; see
 * phases/03-convergence-gating.md acceptance point 6) -- just computed LIVE from whatever
 * `drawOne`/`n` the caller supplies, rather than cited as a fixed constant. Exported so that
 * acceptance point 6's lower bound (eval-runner.sh, D5's historical population, n=15) and
 * compareArms()'s own `power` field (below, THIS run's realized arms, realized n) run the
 * IDENTICAL trial loop -- one simulation, built once, serving both.
 *
 * Never requests `power` on its OWN inner compareArms() calls (`resamples`/`rng` only) -- it is
 * itself a Monte Carlo simulation and must not nest inside another one.
 */
export function estimatePower(drawOne, n, opts = {}) {
  const trials = opts.trials ?? 100;
  const rng = opts.rng ?? Math.random;
  const resamples = opts.resamples ?? 3000;
  const drawArm = () => Array.from({ length: n }, drawOne);
  let accepted = 0;
  for (let t = 0; t < trials; t++) {
    if (compareArms(drawArm(), drawArm(), { resamples, rng }).verdict === 'no-regression') accepted++;
  }
  return accepted / trials;
}

/**
 * Compare two already-filled arms (points 1-2's verdict logic; point 3's cap-breach handling
 * lives in runComparison() below, since a breach is caught before an arm is even complete).
 * Reuses 3.2's already-oracle-verified mannWhitneyU as the ONLY rank-procedure call in this
 * module -- twice, for two different hypotheses, never a second in-house correctness check of the
 * rank test itself (phase file, pass 4's deletion).
 *
 * `no-regression` is an equivalence-style claim, not "not significantly different": shift the
 * candidate arm DOWN by `shift` and re-run the SAME verified procedure with the comparison
 * reversed (candidateShifted vs baseline, testing "baseline stochastically greater"). A small
 * p there is evidence baseline > candidate - shift, i.e. candidate < baseline + shift -- the
 * observed effect's upper confidence bound excludes the +1-pass shift the gate is sized for. This
 * is the standard shift-inversion for a rank-test confidence bound, not a new statistical method.
 *
 * `power` (F-223) is OPT-IN via `opts.power` -- computed from THIS call's own arms (pooled, live),
 * never by default, so it never fires from inside estimatePower()'s own trial loop or from
 * points 1/2's T=600 mass-simulation loops (neither passes `power: true`). The pool-sampling draw
 * always uses `Math.random()`, independent of `opts.rng` (which stays reserved for the actual
 * rank-test resampling) -- the same data-stream/test-stream separation F-233 applies to CVD_SIM.
 */
export function compareArms(baselineArm, candidateArm, opts = {}) {
  const alpha = opts.alpha ?? ALPHA;
  const shift = opts.shift ?? REGRESSION_SHIFT;
  const mwOpts = { resamples: opts.resamples ?? DEFAULT_RESAMPLES, ...(opts.rng ? { rng: opts.rng } : {}) };

  let power;
  if (opts.power) {
    const pool = baselineArm.concat(candidateArm);
    power = estimatePower(() => pool[Math.floor(Math.random() * pool.length)], baselineArm.length,
      { rng: opts.rng, resamples: opts.powerResamples, trials: opts.powerTrials });
  }

  const primary = mannWhitneyU(baselineArm, candidateArm, mwOpts);
  if (primary.p < alpha) return { verdict: 'regression', primary, alpha, shift, power };

  const shifted = candidateArm.map((v) => v - shift);
  const equivalence = mannWhitneyU(shifted, baselineArm, mwOpts);
  const verdict = equivalence.p < alpha ? 'no-regression' : 'inconclusive';
  return { verdict, primary, equivalence, alpha, shift, power };
}

/**
 * The full comparison: fill both arms, fail outright on any drawn cap-breach (R3, point 3) before
 * ever reaching a statistical verdict, block as `insufficient-draws` if either arm falls short of
 * `n` USABLE (post-exclusion) draws (point 4's second half -- measured on the realized arrays,
 * never the requested count), otherwise hand off to compareArms() with live power enabled.
 *
 * `stillRunning`/`replaced` are surfaced at the TOP level on every path (F-223), not only nested
 * under `baseline`/`candidate` -- point 4's "the censoring stays visible even when the floor is
 * satisfied" was unmet on the success path before this, since nothing printed it from there.
 */
export function runComparison(newBaselineDraw, newCandidateDraw, opts = {}) {
  const n = opts.n ?? N_PER_ARM;
  const baseline = fillArm(newBaselineDraw, opts);
  if (baseline.breach) {
    return {
      verdict: 'cap-breach', breachArm: 'baseline', baseline,
      stillRunning: { baseline: baseline.stillRunning, candidate: 0 },
      replaced: { baseline: baseline.replaced, candidate: 0 },
    };
  }
  const candidate = fillArm(newCandidateDraw, opts);
  if (candidate.breach) {
    return {
      verdict: 'cap-breach', breachArm: 'candidate', baseline, candidate,
      stillRunning: { baseline: baseline.stillRunning, candidate: candidate.stillRunning },
      replaced: { baseline: baseline.replaced, candidate: candidate.replaced },
    };
  }

  const stillRunning = { baseline: baseline.stillRunning, candidate: candidate.stillRunning };
  const replaced = { baseline: baseline.replaced, candidate: candidate.replaced };

  if (baseline.arm.length < n || candidate.arm.length < n) {
    return {
      verdict: 'insufficient-draws',
      deficit: { baseline: n - baseline.arm.length, candidate: n - candidate.arm.length },
      stillRunning, replaced, baseline, candidate,
    };
  }
  return { ...compareArms(baseline.arm, candidate.arm, { ...opts, power: true }), stillRunning, replaced, baseline, candidate, n };
}

// ---------------------------------------------------------------------------------------------
// Live draw mechanism -- lib/install.mjs's installSomi/invokeCommand/preflight, UNCHANGED. Not
// exercised by this iteration's tests beyond prepareDrawDir()'s own setup-only seam (R6: hermetic,
// no model calls); phase 4 draws for real against it.
// ---------------------------------------------------------------------------------------------

/**
 * Build (or resume) one fixture workDir's file tree -- SETUP only, no invocation (F-227, code-loop
 * pass 2 review). Split out of startDraw() so a hermetic test can assert the workDir's CONTENTS
 * (scripts/somi-loop.mjs present, .claude/commands/ present) with no model call -- the seam that
 * would have caught the missing `scripts/` copy by evidence, not by reasoning. Mirrors run.mjs's
 * runOnce() fixture setup exactly (the `_somi` -> `.somi` rename, the git baseline commit) with
 * one addition: `scripts/` is copied ALONGSIDE installSomi's own DEFINITION_DIRS copy (not on top
 * of it -- the two land at disjoint workDir paths, `.claude/*` vs `scripts/`, nothing is layered),
 * because /code-loop shells out to scripts/somi-loop.mjs and scripts/somi-findings.mjs at a path
 * relative to cwd ("the SoMi install root") for its own caps/findings arithmetic -- outside
 * installSomi's scope by design (DEFINITION_DIRS is commands/agents/skills/rules only; no other
 * caller needs `scripts/`, since /plan and /code never shell out to either script).
 */
export function prepareDrawDir(sourceDir, fixtureDir) {
  const work = mkdtempSync(join(tmpdir(), 'somi-eval-loop-code-loop-'));
  try {
    cpSync(fixtureDir, work, { recursive: true });
    if (existsSync(join(work, '_somi'))) cpSync(join(work, '_somi'), join(work, '.somi'), { recursive: true });
    rmSync(join(work, '_somi'), { recursive: true, force: true });
    installSomi(sourceDir, work);
    const scriptsDir = join(sourceDir, 'scripts');
    // F-228: a HARD precondition for every live draw, not an optional convenience -- installSomi's
    // own continue-on-missing is right for DEFINITION_DIRS (a definition set may legitimately lack
    // skills/); it is wrong here, where an absence means six wasted model calls (five replacements
    // plus the harness-fault throw) before the first legible failure.
    if (!existsSync(scriptsDir)) {
      throw new Error(`convergence: ${scriptsDir} is missing -- /code-loop shells out to scripts/somi-loop.mjs at a cwd-relative path and cannot run without it`);
    }
    cpSync(scriptsDir, join(work, 'scripts'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
    execFileSync('git', ['config', 'user.email', 'eval@somi.invalid'], { cwd: work });
    execFileSync('git', ['config', 'user.name', 'somi eval'], { cwd: work });
    execFileSync('git', ['add', '-A'], { cwd: work });
    execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: work });
    return work;
  } catch (err) {
    rmSync(work, { recursive: true, force: true }); // F-226: don't leak the partial tree on a setup failure either
    throw err;
  }
}

/** Start (or resume) one real /code-loop draw against task02-code in a fresh working tree. */
export function startDraw(sourceDir, fixtureDir, { model = null } = {}) {
  const work = prepareDrawDir(sourceDir, fixtureDir);
  const statePath = join(work, '.somi', 'somi-state', 'loop', `${LOOP_SLUG}.${LOOP_ITERATION}.json`);
  const read = () => {
    if (!existsSync(statePath)) return null;
    try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return null; }
  };
  const retry = () => { invokeCommand(work, `/code-loop ${LOOP_SLUG} phase 1, iteration ${LOOP_ITERATION}`, { model }); };
  retry();
  return { read, retry, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

// Persist one usable draw at the next FREE slot >= fromIndex, not a blind nextIndex++ (F-248,
// code-loop pass 2 review: nextIndex++ re-collided with resumeArm's own occupied set one call
// later). Exported, not inlined into drawArmForSha, so this write path is testable quota-free;
// MUTATES `occupied` in place, so a caller must thread ONE Set through a whole arm.
//
// `verdict` (F-267, phase 4 iteration 4.1) defaults to `null`, not left `undefined` -- every
// existing call site (this module's own tests, `drawArmForSha` before this iteration) passes only
// six positional args, and `JSON.stringify` DROPS an `undefined` property outright, which would
// make old and new shards differ in which KEYS are present rather than merely in the verdict's
// value. Defaulting to `null` keeps `run.verdict` an always-present key -- explicit "undetermined"
// recorded on disk, the same "absent, and recorded" convention `run.mjs` already uses for its own
// optional fields (`error`, `transcript`, `expiryGuard`, ...), not a key a future reader has to
// remember to check for.
//
// `terminal` (F-268) widens `verdict` to the whole entry `terminalOutcome()` returns, persisted as
// `run.terminal` alongside `run.pass`/`run.verdict` -- `run.verdict` stays too, since every value
// `run.terminal.verdict` can express it already does, harmlessly (same read, so they can't
// disagree). Same "always an explicit key" reasoning as `verdict` above; defaults to `null`.
export function writeNextShard(sha, taskId, n, occupied, fromIndex, pass, verdict = null, terminal = null) {
  let idx = fromIndex;
  while (occupied.has(idx)) idx++;
  if (idx >= n) throw new Error(`convergence: no free shard slot below ${n} for ${sha}`);
  occupied.add(idx);
  const p = loopShardPath(sha, taskId, idx);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ sha, taskId, schema: LOOP_SCHEMA_VERSION, run: { index: idx, pass, verdict, terminal } }, null, 2) + '\n');
  return idx;
}

/**
 * Build the `{newDraw, onDraw}` pair `drawArmForSha()` threads into `fillArm()` (F-267, phase 4
 * iteration 4.1 pass 2 -- closing the "a floor result can't be diagnosed from any retained
 * artifact" gap). `newDraw` wraps the underlying draw factory and remembers the most recently
 * created handle in a closure; `onDraw` re-reads that SAME handle -- `startDraw()`'s `read()` has
 * no side effect, and `fillArm()` calls `onDraw` strictly before its own cleanup, so the state
 * file is still on disk -- to extract `terminalVerdict()` AND `terminalOutcome()` (F-268, pass 3:
 * a verdict string alone can't tell a real round trip from a do-nothing approval -- see
 * `terminalOutcome()`'s own docstring) independently of `classifyDraw()`'s return value, threading
 * both into the same `writeNextShard()` call that already persists `pass`. Only one handle is ever
 * "current" at a time: `fillArm()` fills one arm strictly sequentially (one `newDraw()` call per
 * slot attempt, no concurrency), so the closure can never point at a stale handle.
 *
 * The re-read is guarded (F-270, pass 3): `onDraw` sits in the same post-collection position
 * `safeCleanup()` exists to protect, which swallows by design (F-226: "never let a cleanup FAILURE
 * lose an arm already collected"). A throwing `read()` isn't reachable through `startDraw()`
 * today, but `makeShardWriter()` takes an arbitrary `makeDraw` -- a thrown re-read now degrades the
 * shard's terminal fields to `null` instead of losing the arm.
 *
 * Exported so this assembly is testable against a synthetic draw factory and the REAL
 * `writeNextShard()`/`terminalVerdict()`/`terminalOutcome()` -- without a live `/code-loop`
 * invocation and without touching `fillArm()` itself, which stays exactly as 3.3a's points 4/5 and
 * 3.3c pass 2's F-226/F-232/F-248 left it. `drawArmForSha()` below is now a thin assembly of
 * already-tested pieces.
 *
 * @param {() => {read: () => *, retry: () => void, cleanup?: () => void}} makeDraw  the underlying
 *   draw factory (`() => startDraw(...)` in `drawArmForSha()`; a synthetic stand-in in tests).
 * @param {string} sha
 * @param {string} taskId
 * @param {number} n
 * @param {Set<number>} occupied  mutated in place by `writeNextShard()`, same contract as there.
 * @param {number} startIndex
 * @returns {{newDraw: () => *, onDraw: (pass: number) => void}}
 */
export function makeShardWriter(makeDraw, sha, taskId, n, occupied, startIndex) {
  let current = null;
  let nextIndex = startIndex;
  return {
    newDraw() { current = makeDraw(); return current; },
    onDraw(pass) {
      let state;
      try { state = current.read(); } catch { state = null; }
      nextIndex = writeNextShard(sha, taskId, n, occupied, nextIndex, pass, terminalVerdict(state), terminalOutcome(state)) + 1;
    },
  };
}

/**
 * Draw (or resume) one SHA's arm, persisting each newly-completed slot as a shard so a killed
 * process resumes rather than re-drawing -- this module's OWN namespace (resumeArm/loopShardPath
 * above, F-225), not run.mjs's shared one. `mergeShards()` is deliberately NOT reused here: its
 * output shape (dimensions/reportOnly via buildResult()) is the S1-S7 task-grading system and does
 * not fit a plain array of pass-counts, so folding shards for one arm is a five-line read here
 * rather than a borrowed 20-line function built for a different shape.
 *
 * Preflights (F-229, code-loop pass 2 review) before any work: this is the first function in the
 * module that can spend quota, and a run with no `claude` on PATH or no credential should fail
 * once, loudly, named -- not thirty times, one abandoned work tree each.
 */
export function drawArmForSha(sourceDir, fixtureDir, sha, opts = {}) {
  const pf = preflight();
  if (!pf.ready) throw new Error(`convergence: not ready to draw -- ${pf.problems.join('; ')}`);
  const n = opts.n ?? N_PER_ARM;
  const { resume, nextIndex: startIndex, occupied } = resumeArm(sha, TASK_ID, n);
  const { newDraw, onDraw } = makeShardWriter(() => startDraw(sourceDir, fixtureDir, opts), sha, TASK_ID, n, occupied, startIndex);
  return fillArm(newDraw, { ...opts, n, resume, onDraw });
}

// ---------------------------------------------------------------------------------------------
// CLI (3.4) -- mirrors run.mjs's shape (--source/--fixture/--runs/--merge/--certify) and its
// --dry-run contract (well-formed shape, zero model calls). A separate entrypoint by design (see
// the module docstring); this section is what makes the module above runnable as a command.
// ---------------------------------------------------------------------------------------------

/**
 * F-251 (3.3c pass-2 review, deferred here on the review's own instruction): `sha` reaches
 * `join()` unvalidated inside loopShardPath()/loopShardDir(), so a value like `../../../foo`
 * escapes `results/`. Not reachable from untrusted input before this CLI existed -- every prior
 * caller passed either a git-resolved sha (resolveSource()) or a test-authored literal. THIS CLI
 * is what makes `sha` a documented, human-typed input surface (--merge/--certify <sha>), which is
 * where the boundary check belongs -- not inside loopShardPath()/loopShardDir() themselves, which
 * this module's own test suite exercises throughout with synthetic, non-hex identifiers (e.g.
 * 'f229preflight') that a library-level guard would break.
 */
export function validateSha(sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`not a valid sha (7-40 lowercase hex chars): ${JSON.stringify(sha)}`);
  }
  return sha;
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sampleSd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function parseArgs(argv) {
  const a = { source: 'HEAD', fixture: null, runs: N_PER_ARM, model: null, dryRun: false, merge: null, certify: null };
  let i = 0;
  // F-252/F-253/F-259/F-261/F-262: missing, empty, and flag-shaped operands are ALL "no value" -- an empty string is not `undefined`, and a single dash is still a flag, not a literal.
  const val = (k) => { const v = argv[++i]; if (v === undefined || v === '' || /^-/.test(v)) throw new Error(`${k} requires a value`); return v; };
  for (; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source') a.source = val(k);
    else if (k === '--fixture') a.fixture = val(k);
    else if (k === '--runs') a.runs = Number(val(k));
    else if (k === '--model') a.model = val(k);
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--merge') a.merge = val(k);
    else if (k === '--certify') a.certify = val(k);
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (!Number.isInteger(a.runs) || a.runs <= 0) throw new Error(`--runs must be a positive integer`);
  return a;
}

const USAGE = `somi convergence gate driver

  node tests/evals/convergence.mjs --source <git-ref|path> [options]

  --source <ref|path>  definition set to draw one arm for (default HEAD). Same resolution rule as
                       run.mjs's --source: a git ref is checked out into a detached worktree and
                       removed afterwards; a path is used in place (sha recorded as null).
  --fixture <path>     fixture dir (default: task02-code, D9 -- the only fixture shaped for a
                       code+review loop)
  --runs N             target arm size (default ${N_PER_ARM}, D2)
  --model NAME         model to invoke /code-loop with (default: the claude CLI's own default)
  --merge <sha>        fold shards already on disk for <sha> into an arm; report count/mean/sd.
                       No live draw, no credential needed.
  --certify <sha>      same as --merge -- folding IS the report; there is no second, narrower
                       scope here the way run.mjs's --certify differs from --merge.
  --dry-run            build the result shape without invoking a model. No network, no credential.

Requires network and an API credential unless --dry-run or --merge/--certify (both read-only).
Each draw persists as its own shard the moment it completes (results/<sha>/convergence/), so a
killed or re-run invocation resumes rather than re-drawing -- the same discipline run.mjs's own
--batch/resume model established; re-invoke with the same --source and a --runs target to continue.`;

/** `--merge`/`--certify`: read back whatever shards already exist for `sha`, no live draw. */
function reportArm(sha, runs) {
  const { resume: arm } = resumeArm(sha, TASK_ID, runs);
  const m = arm.length ? mean(arm) : null;
  const sd = sampleSd(arm);
  process.stdout.write(
    `${sha.slice(0, 12)}: ${arm.length}/${runs} usable draw(s) on disk\n` +
    `  arm:  [${arm.join(', ')}]\n` +
    `  mean: ${m === null ? 'n/a' : m.toFixed(4)}\n` +
    `  sd:   ${sd === null ? 'n/a (need >= 2 draws)' : sd.toFixed(4)}\n`);
  return { sha, taskId: TASK_ID, runs, arm, mean: m, sd };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(USAGE + '\n'); return 0; }

  // Read-only, no draw: resolves neither --source nor a live invocation, so a sha typed straight
  // off a prior run's stdout works with no network and no credential. F-259: `!== null`, not truthy.
  if (args.merge !== null || args.certify !== null) {
    reportArm(validateSha(args.merge ?? args.certify), args.runs);
    return 0;
  }

  if (args.dryRun) {
    // Shape only, mirroring run.mjs --dry-run's own contract: neither preflight() nor
    // startDraw()/invokeCommand() is reached on this branch -- confirmed by a stub-`claude`-on-
    // PATH sentinel test (tests/scripts/convergence-runner.sh), not merely by reading this code.
    const source = resolveSource(args.source);
    try {
      const out = {
        schema: LOOP_SCHEMA_VERSION, dryRun: true, taskId: TASK_ID,
        source: { ref: source.ref, sha: source.sha }, fixture: args.fixture ?? fixtureFor('02', source.dir),
        runsRequested: args.runs, arm: [], breach: false,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return 0;
    } finally {
      source.cleanup();
    }
  }

  // Checked BEFORE resolveSource's worktree checkout, matching run.mjs's own "before any work"
  // rule -- drawArmForSha() preflights too (F-229), but only after a live source is already
  // resolved; failing here first avoids paying for a checkout this run cannot use anyway.
  const pf = preflight();
  if (!pf.ready) throw new Error(`not ready to draw -- ${pf.problems.join('; ')}. Use --dry-run for a shape check.`);
  const source = resolveSource(args.source);
  try {
    const fixtureDir = args.fixture ?? fixtureFor('02', source.dir);
    const result = drawArmForSha(source.dir, fixtureDir, source.sha, { n: args.runs, model: args.model });
    process.stdout.write(
      `${(source.sha ?? 'unversioned').slice(0, 12)}: ${result.breach ? 'CAP-BREACH' : `${result.arm.length}/${args.runs} usable draw(s)`}\n` +
      `  arm:           [${result.arm.join(', ')}]\n` +
      `  stillRunning:  ${result.stillRunning}\n` +
      `  replaced:      ${result.replaced}\n` +
      `  waitExhausted: ${result.waitExhausted}\n`);
    return 0;
  } finally {
    source.cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => { process.stderr.write(`convergence: ${err.message}\n`); process.exit(1); });
}
