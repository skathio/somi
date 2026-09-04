#!/usr/bin/env node
// tests/evals/convergence.mjs -- classification + arm-filling for the convergence gate DRIVER
// (phase 3, D1-D5, R2/R3). This is iteration 3.3a's carve of 3.3's complete module, not a
// rewrite (see the split banner above iteration 3.3 in phases/03-convergence-gating.md): pass 2
// of 3.3 landed all six acceptance points at 861 lines against a cap already raised once to 510,
// and was split along the module's own section divider rather than re-implemented. This file
// owns acceptance points 4 and 5 -- the classification and draw-policy layer, fully hermetic
// behind an injected `newDraw`, decided before any comparison happens. The other two seams carve
// back in from the same preserved pass-2 module, each in its own capped iteration:
//   - compareArms, estimatePower, runComparison and points 1/2/3/6 -> 3.3b (the verdict layer).
//   - loopShardPath, resumeArm, prepareDrawDir, startDraw, drawArmForSha -> 3.3c (the only part
//     that spends quota or touches disk).
//
// Two traps this file exists specifically to not reintroduce (see phases/03-convergence-gating.md
// iteration 3.3's revision history for the full reasoning). A third trap belonged to compareArms's
// own never-accepts direction (F-221, Blocker) -- that function, and the mutant/checks that catch
// it, return with 3.3b, which owns it.
//  1. capBreached() is three-way. `if (!capBreached(o))` reads a `running` loop's null as
//     "not breached" and silently counts it -- classifyDraw() below never does that comparison.
//  2. Excluding a `running` draw is INFORMATIVE censoring (slow -> more passes -> the arm that
//     regressed), so "draw until the arm holds N_PER_ARM usable draws" cancels the detector it
//     exists to serve. fillArm() below never substitutes a fresh draw for a censored one -- it
//     waits on the SAME draw (bounded), and gives up on the whole arm rather than topping it back
//     up if the wait budget runs out.

import { capBreached, passesToApprove } from './lib/convergence.mjs';

// D2: the floor at which an inconclusive result reads as inconclusive rather than an accepted
// pass. Pinned as a literal -- acceptance point 4's first half asserts this exact value,
// independent of any draw outcome (nothing else in this module is n-agnostic by accident).
export const N_PER_ARM = 15;
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
 * than substituting a replacement for it -- the arm is returned short, which the caller
 * (runComparison, 3.3b) turns into `insufficient-draws`, not a silently topped-up mean. Every
 * handle this loop is done with (pushed, breached, wait-exhausted, or discarded as malformed) is
 * cleaned up before the function moves on (F-226) -- the only handle NEVER cleaned up mid-arm is
 * one still being retried, since retry() reuses the SAME workDir.
 *
 * `stillRunning`/`replaced` are RETURNED on every path even though nothing in this file reads
 * them: compareArms()/runComparison() were carved out to 3.3b, not their consumption of these
 * two counts -- point 4 requires the censoring stay visible "even when the floor is satisfied",
 * and 3.3b restores the top-level reader (F-223). Not dead fields; a temporarily unread contract.
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
