#!/usr/bin/env node
// Reads /code-loop's loop-state JSON (`.somi/somi-state/loop/<slug>.<iteration>.json`) for the
// convergence gate (phase 3, D1-D5, R3). Six independent extractions -- 3.2's Mann-Whitney code
// calls none of them. Some reuse each other's already-tested guard for ordinary DRY reasons
// (`breachReason()` calls `capBreached()`; `censoredDrawSnapshot()`, F-295, calls both
// `passesToApprove()` and `terminalVerdict()`) -- `terminalVerdict()`/`terminalOutcome()` are the
// ONE pair that deliberately does NOT reuse each other, so two independently-coded copies of the
// same "last history entry, guarded" logic over the SAME terminal draw can disagree under a
// mutation and both be caught (see `terminalOutcome()`'s own docstring) -- a property duplication
// buys only when there are two independent readings of the same underlying fact to cross-check,
// which is not the case for the other reuses above.
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
 * Strip the documented `stopped-<reason>` finish-form prefix (F-235, `commands/code-loop.md:136`)
 * down to the bare `<reason>`; returns `status` unchanged if it doesn't carry the prefix.
 * Extracted (F-46, pass-2 review) so `capBreached()` and `breachReason()` share ONE copy of this
 * one-line strip instead of two independent copies that could silently drift apart if F-235's
 * convention ever widens (e.g. a second prefix added to one copy and not the other) -- both
 * existing test loops (`eval-runner.sh`) only ever probe `$s` and `stopped-$s`, so a divergence
 * here would read as a green suite reporting a WRONG reason, not a safe `null`.
 *
 * @param {string} status
 * @returns {string}
 */
function stripStoppedPrefix(status) {
  return status.startsWith('stopped-') ? status.slice('stopped-'.length) : status;
}

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
  const reason = stripStoppedPrefix(status);
  if (CAP_BREACH_STATUSES.has(reason)) return true;
  // Deliberately tests unstripped `status`, not `reason` (F-239): `done` is the SUCCESS terminal
  // and never legitimately carries `stopped-`, so `stopped-done` must stay null, not fold in here.
  if (status === 'done') return false;
  return null;
}

/**
 * The SPECIFIC cap-breach reason for one loop draw (D6, phase 2 iteration 2.4 --
 * `tests/evals/convergence.mjs`'s `fillArm()` breach branch, D5's own Blocker-2 gap: a breach was
 * detectable via `capBreached()` but not diagnosable -- `max-passes-exceeded` and
 * `diff-cap-exceeded` call for different corrections and previously read identically as
 * `{breach: true}`).
 *
 * Gates on `capBreached(loopStateJson) === true` -- reusing that already-tested five-status
 * membership check rather than re-matching `CAP_BREACH_STATUSES` a second time here -- then
 * strips the same `stopped-<reason>` prefix `capBreached()` strips internally (F-235), via the
 * shared `stripStoppedPrefix()` helper both functions call (F-46, pass-2 review: the original
 * shipped shape duplicated this one-line strip in each function independently, which a later
 * widening of F-235's convention could silently desync -- see that helper's own docstring).
 *
 * @param {*} loopStateJson  a parsed loop-state object (see `passesToApprove`'s param doc).
 * @returns {string|null} the bare `<reason>` form (e.g. `'max-passes-exceeded'`), true for
 *   BOTH the bare and the documented `stopped-<reason>` write form (F-235) -- identically to
 *   `capBreached()`'s own true/false/null split, so a caller never needs to re-derive that gate;
 *   `null` whenever `capBreached()` would return anything other than `true` (not a breach, or
 *   undetermined) -- fails safe, same convention as every extractor above, never a guessed reason.
 */
export function breachReason(loopStateJson) {
  if (capBreached(loopStateJson) !== true) return null;
  const { status } = loopStateJson;
  return stripStoppedPrefix(status);
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
 * own header names this pair specifically as the one that deliberately does not reuse each other's
 * guard, so a mutation to one copy can disagree with the other over the SAME terminal draw and be
 * caught, rather than one silently deferring to the other's (possibly mutated) answer.
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
 * reaching this function, so re-testing that would be redundant, not confirmatory. Six fields:
 * `status` (should read `"running"` for a draw that reached this path at all, but read off the
 * raw object rather than assumed, in case a malformed intermediate state slips through);
 * `historyEmpty`; `stateReadable`; `pass`; `completedPasses`; `lastVerdict`.
 *
 * `pass` and `lastVerdict` (F-294/F-295, phase 4 iteration 4.6): a real censored draw
 * (`multipass-fixture`'s diary, 2026-09-13) showed this snapshot could say a loop was `running`
 * but not how far it had gotten -- exactly the fact that separates "iterating" (the floor took
 * effect) from "slow" (no signal either way). `pass` reuses `passesToApprove()` directly: that
 * function's own contract is "pure field extraction, deliberately blind to status" -- precisely a
 * still-running draw's PROVISIONAL pass count, no re-derivation needed. `lastVerdict` calls
 * `terminalVerdict()` directly, a DELIBERATE departure from the `terminalVerdict()`/
 * `terminalOutcome()` non-calling convention this module's header states for THOSE two: that
 * convention protects against two independent readings of the SAME finished draw silently
 * disagreeing under a mutation (F-273/F-274) -- there is no second reading of a still-running
 * draw's last verdict here to diverge from, so a second, driftable copy of `terminalVerdict()`'s
 * four-line "last entry, guarded" logic would be redundant duplication, not a second instrument
 * (the same reuse call `breachReason()` already makes into `capBreached()`, not a new pattern).
 * Both fail safe via the callee's own guard -- `null` on any unrecognised shape, never re-derived
 * or defaulted here.
 *
 * `completedPasses` (F-296, phase 4 iteration 4.6 pass-1 review): `pass` above is NOT "the last
 * pass that finished" -- it is whatever `scripts/somi-loop.mjs pass` last wrote to `state.pass`,
 * and that subcommand sets it BEFORE the pass's own coder/reviewer round trip begins
 * (`state.pass = cur + 1`, then the work happens; `record-pass` only appends to `history` AFTER a
 * verdict lands). So a `running` draw with `pass: 2` is genuinely ambiguous on `pass` alone between
 * two different states: mid-pass-2 (`history.length === 1`, so `lastVerdict` belongs to pass 1, not
 * 2) and just past pass 2's own `record-pass`, waiting on the next `pass` call (`history.length ===
 * 2`, `lastVerdict` belongs to pass 2). Not hypothetical: this very iteration's own live loop state
 * read `{pass: 1, history: []}` at the pass-1 review that raised this finding -- mid-pass 1,
 * nothing completed, not "a slow pass 1 that already produced a verdict". `completedPasses` is
 * `history.length` (or `null` if `history` isn't a readable array, the same fail-safe posture as
 * every field here) -- the plain disambiguator: `lastVerdict`, when non-`null`, is always the
 * verdict of pass `completedPasses`, never of `pass` itself. Read `pass` (here and in
 * `docs/EVALS.md`'s censoring paragraph, corrected in this same pass) as "the pass most recently
 * STARTED, possibly still in progress" -- never as "the last completed pass".
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
 * @returns {{status: string|null, historyEmpty: boolean|null, stateReadable: boolean, pass: number|null, completedPasses: number|null, lastVerdict: string|null}}
 */
export function censoredDrawSnapshot(loopStateJson) {
  const stateReadable = loopStateJson !== null && typeof loopStateJson === 'object';
  // Both calls are safe on ANY input, including a non-object -- passesToApprove()/terminalVerdict()
  // carry their own `loopStateJson === null || typeof ... !== 'object'` guard, so there is no need
  // to gate these two calls behind `stateReadable` the way status/historyEmpty are gated below.
  const pass = passesToApprove(loopStateJson);
  const lastVerdict = terminalVerdict(loopStateJson);
  // completedPasses (F-296): the plain `pass` vs `completedPasses` disambiguator -- see this
  // function's own docstring. Read directly off `history.length` (not derived from `historyEmpty`
  // below -- `historyEmpty` is defined in terms of THIS value, not the reverse, so the two can
  // never silently drift apart).
  const history = stateReadable ? loopStateJson.history : undefined;
  const completedPasses = Array.isArray(history) ? history.length : null;
  if (!stateReadable) {
    return { status: null, historyEmpty: null, stateReadable, pass, completedPasses, lastVerdict };
  }
  const { status } = loopStateJson;
  return {
    status: typeof status === 'string' ? status : null,
    historyEmpty: completedPasses === null ? null : completedPasses === 0,
    stateReadable,
    pass,
    completedPasses,
    lastVerdict,
  };
}
