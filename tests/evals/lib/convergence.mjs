#!/usr/bin/env node
// Reads /code-loop's loop-state JSON (`.somi/somi-state/loop/<slug>.<iteration>.json`) for the
// convergence gate (phase 3, D1-D5, R3). Two independent extractions -- 3.2's Mann-Whitney code
// calls neither of them, and neither calls the other.
//
// FAILS SAFE. Both exports return `null` on a shape they don't recognise, never a guessed boolean
// or number -- "a parser that guesses `false` fails a conforming run" is this corpus's own
// repeated lesson (`lib/reproduce.mjs`, `lib/boundary.mjs`'s `slug` fallback). A `null` here means
// "the caller must decide", never "no".

/**
 * Statuses `commands/code-loop.md` documents as terminal cap-breach outcomes -- a breach fails the
 * convergence gate outright, independent of any statistical comparison (R3). `done` is the
 * documented terminal SUCCESS status and is deliberately not in this set. `running` (the status
 * `scripts/somi-loop.mjs init` writes before a loop finishes) is also deliberately not in this
 * set: a running loop has neither converged nor breached yet, and treating "not done" as
 * "breached" would mark a live loop as a cap failure it has not committed -- see `capBreached()`'s
 * own docstring.
 */
// Exported (not just module-private) so callers that need the raw enum -- notably
// `tests/scripts/eval-runner.sh`'s own gate assertions -- read it rather than retype it (F-187:
// the shell script had grown two of its own hardcoded copies of this exact list before this
// export existed). This is a data constant the tests read, not a behavioral guard re-implemented
// outside the module -- the declined `convergenceCost()` seam (see 3.3's acceptance point 5) is a
// different shape of ask and stays declined.
export const CAP_BREACH_STATUSES = new Set([
  'max-passes-exceeded',
  'diff-cap-exceeded',
  'scope-expansion',
  'circuit-breaker',
  'user-stop',
]);

/**
 * Passes-to-approve for one loop draw -- the top-level `pass` field `context.md` §2.5 confirms is
 * exactly the value D2's own baseline arithmetic used (D10, which supersedes D4 on the same
 * conclusion).
 *
 * Pure field extraction, deliberately blind to `status`: whether a `pass` count represents a
 * FINISHED draw is `capBreached()`'s job, not this one's -- a loop still `status: "running"` (or
 * one just `init`'d, `status: "running"`/`pass: 0`) has a real, provisional `pass` field this
 * function returns as-is. **The caller must check `status` (or a non-`null` `capBreached()`
 * reading) before treating this value as a completed draw's convergence cost** -- 3.1 builds the
 * two extractors, not the driver that combines them (3.3).
 *
 * @param {*} loopStateJson  a parsed loop-state object -- e.g.
 *   `JSON.parse(fs.readFileSync(path, 'utf8'))` -- not a raw JSON string. Anything else fails safe.
 * @returns {number|null} the `pass` field, or `null` if it isn't a finite non-negative integer --
 *   an unrecognised shape, never a guessed `0`.
 */
export function passesToApprove(loopStateJson) {
  if (loopStateJson === null || typeof loopStateJson !== 'object') return null;
  const { pass } = loopStateJson;
  if (typeof pass !== 'number' || !Number.isInteger(pass) || pass < 0) return null;
  return pass;
}

/**
 * Does this draw's `status` land on one of the documented cap-breach terminal states (R3)? A
 * cap-breach fails the convergence gate outright, independent of any statistical comparison.
 *
 * Three-way, not two-way: `true` (a documented breach), `false` (the documented success terminal,
 * `"done"`), or `null` for anything else -- most notably `"running"`, the real non-terminal status
 * a loop still in progress carries (this corpus's own population currently includes loop-state
 * files mid-loop, one of them this very iteration's). `false` was considered and rejected for
 * `"running"`: it would assert "confirmed clean", which is not yet true of a loop that hasn't
 * finished -- exactly the "the tool is now measuring a corpus it is itself a member of" trap.
 * `null` says "undetermined", the honest reading, and matches this module's own fail-safe
 * convention above.
 *
 * @param {*} loopStateJson  a parsed loop-state object (see `passesToApprove`'s param doc).
 *   Anything else, or a `status` that isn't a string, fails safe.
 * @returns {boolean|null}
 */
export function capBreached(loopStateJson) {
  if (loopStateJson === null || typeof loopStateJson !== 'object') return null;
  const { status } = loopStateJson;
  if (typeof status !== 'string') return null;
  // F-235: commands/code-loop.md:136 documents `--status stopped-<reason>` as what the STOP path
  // writes on finish -- CAP_BREACH_STATUSES above stays the bare <reason> forms (eval-runner.sh's
  // own 3.1 assertions and this module's callers read it directly, so it is not widened to carry
  // the prefix); strip a leading `stopped-` before matching instead. Without this, a cap-breach
  // recorded through the DOCUMENTED path read null ("undetermined") here, not true -- discovered
  // 2026-09-04 by the first status:"stopped-*" loop-state file this corpus ever produced (every
  // real file before it was `done` or `running`, so nothing had ever exercised this branch on
  // real data). classifyDraw() (tests/evals/convergence.mjs) calls capBreached() directly and
  // inherited the same hole, which is why the fix lands here rather than in a second call site.
  const reason = status.startsWith('stopped-') ? status.slice('stopped-'.length) : status;
  if (CAP_BREACH_STATUSES.has(reason)) return true;
  // Deliberately tests unstripped `status`, not `reason` (F-239): `done` is the SUCCESS terminal
  // and never legitimately carries `stopped-`, so `stopped-done` must stay null, not fold in here.
  if (status === 'done') return false;
  return null;
}
