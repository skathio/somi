#!/usr/bin/env node
// Reads /code-loop's loop-state JSON (`.somi/somi-state/loop/<slug>.<iteration>.json`) for the
// convergence gate (phase 3, D1-D5, R3). Four independent extractions -- 3.2's Mann-Whitney code
// calls none of them, and no two of them call each other.
//
// FAILS SAFE. All four exports return `null` on a shape they don't recognise, never a guessed
// boolean, number, or string -- "a parser that guesses `false` fails a conforming run" is this
// corpus's own repeated lesson (`lib/reproduce.mjs`, `lib/boundary.mjs`'s `slug` fallback). A
// `null` here means "the caller must decide", never "no".
//
// `terminalVerdict()` added phase 4, iteration 4.1 (F-267): the first live draws showed
// `task02-code` sitting at the pass-count floor (arm [1,1,1], mean 1.0, sd 0.0) with no retained
// artifact able to say WHY -- `run.mjs`'s shard carried only `pass`, and `cleanup()` (F-226)
// correctly destroys the workDir the instant a draw completes. This extractor is the fix's read
// side; `tests/evals/convergence.mjs`'s `writeNextShard()`/`makeShardWriter()` are the write side
// that threads its result into the shard alongside `pass`.
//
// `terminalOutcome()` added phase 4, iteration 4.1 pass 3 (F-268): `terminalVerdict()` alone
// can't distinguish a real coder/reviewer round trip from a loop that approved an untouched tree
// -- see its own docstring below.

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

/**
 * Terminal verdict for one loop draw -- diagnostic only (F-267), never a gating input. Per
 * `commands/code-loop.md`/`scripts/somi-loop.mjs record-pass --verdict`, the state file's
 * `history[]` is an ordered array of per-pass `{pass, verdict, ...}` entries; the loop's terminal
 * verdict is the LAST one, the same way `passesToApprove()`'s `pass` is the top-level field D10
 * already established as the single scalar this design's whole apparatus assumes per draw.
 *
 * FAILS SAFE, same posture as `passesToApprove()`/`capBreached()` above, and for the same reason
 * named directly in the constraint that motivated this export: the three shards phase 4 already
 * paid ~23 minutes of real quota for were written before this field existed and carry no
 * `run.verdict` at all -- an absent or unrecognised shape must read as `null` ("undetermined"),
 * never coerced into a guessed string, and must never make an otherwise-usable draw look
 * malformed. Nothing in this module (or its caller) treats a `null` verdict as disqualifying --
 * that would silently re-introduce the exact defect this export exists to avoid.
 *
 * @param {*} loopStateJson  a parsed loop-state object (see `passesToApprove`'s param doc).
 * @returns {string|null} the last `history[]` entry's `verdict`, or `null` on any unrecognised
 *   shape -- no `history`, an empty or non-array `history`, or a last entry whose `verdict` isn't
 *   a string.
 */
export function terminalVerdict(loopStateJson) {
  if (loopStateJson === null || typeof loopStateJson !== 'object') return null;
  const { history } = loopStateJson;
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (last === null || typeof last !== 'object' || typeof last.verdict !== 'string') return null;
  return last.verdict;
}

/**
 * Whole terminal-entry evidence for one loop draw -- diagnostic only (F-268), never a gating
 * input. Widens `terminalVerdict()`: `{pass: 1, verdict: "approve"}` is exactly what a loop that
 * approved an untouched tree would also write, so a verdict string alone can't tell a real
 * coder/reviewer round trip apart from a null one. `record-pass` (`scripts/somi-loop.mjs`) builds
 * each history entry as `{pass, verdict, blockers, majors, diff_lines, at}`; `diffLines` separates
 * a real round trip from an empty-diff approval, `blockers`/`majors` a real review from an absent
 * one.
 *
 * FAILS SAFE like every extractor above: `null` on any unrecognised shape, and EACH field
 * independently `null` (never defaulted to 0/false) so an absent count can't read as "zero found".
 * Duplicates the "last, not first" step rather than calling `terminalVerdict()` -- this module's
 * own header states no two extractors call each other.
 *
 * @param {*} loopStateJson  a parsed loop-state object (see `passesToApprove`'s param doc).
 * @returns {{verdict: string|null, blockers: number|null, majors: number|null, diffLines: number|null}|null}
 *   `null` on any unrecognised shape; otherwise every field independently `null` unless present
 *   and (for the three counts) a non-negative integer.
 */
export function terminalOutcome(loopStateJson) {
  if (loopStateJson === null || typeof loopStateJson !== 'object') return null;
  const { history } = loopStateJson;
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (last === null || typeof last !== 'object') return null;
  const count = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    verdict: typeof last.verdict === 'string' ? last.verdict : null,
    blockers: count(last.blockers),
    majors: count(last.majors),
    diffLines: count(last.diff_lines),
  };
}
