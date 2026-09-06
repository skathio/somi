#!/usr/bin/env node
// Reads /code-loop's loop-state JSON (`.somi/somi-state/loop/<slug>.<iteration>.json`) for the
// convergence gate (phase 3, D1-D5, R3). Five independent extractions -- 3.2's Mann-Whitney code
// calls none of them, and no two of them call each other.
//
// FAILS SAFE. The first four exports return `null` on a shape they don't recognise, never a
// guessed boolean, number, or string -- "a parser that guesses `false` fails a conforming run" is
// this corpus's own repeated lesson (`lib/reproduce.mjs`, `lib/boundary.mjs`'s `slug` fallback). A
// `null` here means "the caller must decide", never "no". `censoredDrawSnapshot()` (added F-276)
// keeps the same never-guess posture at the FIELD level instead of the whole-return level -- see
// its own docstring for why.
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
//
// `censoredDrawSnapshot()` added phase 4, iteration 4.4 (F-276): the two exports above read a
// FINISHED draw's terminal history entry; this one reads a still-`running` (CENSORED) draw's
// state instead -- the shape `fillArm()` (`tests/evals/convergence.mjs`) discards entirely once
// its wait budget is exhausted, with nothing retained to tell "the loop was genuinely slow" apart
// from "the subprocess died in thirty seconds". See its own docstring below.

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

/**
 * Last-seen snapshot of a CENSORED (still-`running`) draw's loop state -- the retained-evidence
 * half of F-276 (phase 4, iteration 4.4). `fillArm()`'s wait-exhausted path (`fillArm()`'s own
 * docstring, `tests/evals/convergence.mjs`) gives up on a draw that never leaves `running` and
 * previously discarded its last-read state entirely -- no shard is written on that path, and
 * `safeCleanup()` removes the workDir the instant the handle is done with, so "the loop was
 * genuinely slow" (cost-correlated, biases an arm's upper tail away -- F-185) and "the subprocess
 * died in thirty seconds" (uncorrelated with cost) were indistinguishable from any retained
 * artifact. This snapshot, paired with `fillArm()`'s own elapsed-wall-clock and wait-attempt
 * count, is what makes that distinguishable after the fact -- it does not decide which one
 * happened, only records what the last read actually showed.
 *
 * Deliberately narrow, unlike `terminalVerdict()`/`terminalOutcome()` above: does NOT re-derive
 * `capBreached()` -- the caller already knows this draw classified as `running` before ever
 * reaching this function, so re-testing that would be redundant, not confirmatory. Three fields:
 * `status` (should read `"running"` for a draw that reached this path at all, but read off the
 * raw object rather than assumed, in case a malformed intermediate state slips through);
 * `historyEmpty`; `stateReadable`.
 *
 * `historyEmpty`, corrected (F-277, code-loop pass 2 review): `scripts/somi-loop.mjs` appends to
 * `history` in exactly one place (`record-pass`, gated on `--verdict`), which fires only once a
 * review pass has COMPLETED -- `init` writes `history: []` and nothing touches it before then. So
 * `historyEmpty: true` means only "no pass has completed yet"; it does NOT separate a loop
 * genuinely grinding through pass 1 (which leaves no trace in `history` until a verdict lands)
 * from one that died moments after `init` -- both read identically. `fillArm()`'s own `elapsedMs`
 * is the field that actually discriminates those two hypotheses; `historyEmpty` is corroborating
 * context, not proof.
 *
 * `stateReadable` (F-279, code-loop pass 2 review): `true` when `loopStateJson` is itself a
 * non-null object (however malformed its fields), `false` when it is not -- the distinction
 * flattening to `{status, historyEmpty}` alone had cost, since a garbled-but-parsed object
 * (`{status: 7, history: 'nope'}`) and no object at all (`null`) previously produced the
 * byte-identical record. Does NOT further split "the state file was never written" from "it
 * existed but its JSON failed to parse" -- `startDraw()`'s own `read()` already collapses those
 * two into the same `null` before this function ever sees the result; widening that contract is a
 * separate change. On `fillArm()`'s own call site today `stateReadable` reads `true` on every
 * real censor record (`classifyDraw(null)` routes to `'malformed'`, not `'running'`, so a `null`
 * read never reaches this function that way) -- this field is this function's own general,
 * exported contract, not a claim about what today's one caller currently produces.
 *
 * FAILS SAFE like every extractor above: an absent, wrongly-typed, or unrecognised field reads
 * `null` ("undetermined"), never coerced or defaulted -- an object is always returned (never a
 * top-level `null`) because the caller only ever invokes this once a censoring event is already
 * known to have occurred; only `status`/`historyEmpty` may independently be unrecoverable --
 * `stateReadable` is always a determinate boolean.
 *
 * @param {*} loopStateJson  a parsed loop-state object (see `passesToApprove`'s param doc), or
 *   whatever the last `read()` returned -- including `null` if the read itself failed.
 * @returns {{status: string|null, historyEmpty: boolean|null, stateReadable: boolean}}
 */
export function censoredDrawSnapshot(loopStateJson) {
  const stateReadable = loopStateJson !== null && typeof loopStateJson === 'object';
  if (!stateReadable) return { status: null, historyEmpty: null, stateReadable };
  const { status, history } = loopStateJson;
  return {
    status: typeof status === 'string' ? status : null,
    historyEmpty: Array.isArray(history) ? history.length === 0 : null,
    stateReadable,
  };
}
