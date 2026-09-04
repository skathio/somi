#!/usr/bin/env node
// tests/evals/convergence.mjs -- classification, arm-filling, comparison and the three-state
// verdict for the convergence gate DRIVER (phase 3, D1-D5, R2/R3). This is 3.3's preserved
// pass-2 module (see the split banner above iteration 3.3 in phases/03-convergence-gating.md),
// carved back in across 3.3a and 3.3b rather than re-implemented: pass 2 landed all six
// acceptance points at 861 lines against a cap already raised once to 510, and was split along
// the module's own section divider. **3.3a (done)** carved classifyDraw/fillArm/safeCleanup --
// points 4 and 5, the classification and draw-policy layer. **This carve (3.3b)** adds
// compareArms, estimatePower and runComparison -- points 1, 2, 3 and 6, the verdict layer, which
// consumes 3.3a's already-filled arms and adds no new I/O. Still out:
//   - loopShardPath, resumeArm, prepareDrawDir, startDraw, drawArmForSha -> 3.3c (the only part
//     that spends quota or touches disk) -- this file makes no `claude` subprocess call.
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

import { capBreached, passesToApprove } from './lib/convergence.mjs';
import { mannWhitneyU, DEFAULT_RESAMPLES } from './lib/mann-whitney.mjs';

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
