#!/usr/bin/env node
// Executes task 01 criterion 6 instead of judging it.
//
// The criterion is a file-list check against an allowlist -- purely mechanical, and it should
// never have been a judged criterion. It became one only because everything in task 01 was.
//
// It was found by disagreement: judge-agreement.mjs put sonnet and haiku on opposite sides of it
// for the same run. Adjudicating from the stored evidence, haiku was right -- every path it
// enumerated (.somi/README.md, audit.log, somi-state/**, .somi/plans/<slug>/**) is explicitly
// allowlisted and the diff was empty. A criterion two models read differently is a criterion that
// should not be read at all.

/**
 * @param {{status:string,path:string}[]} changed  working-tree entries, relative to the repo root
 * @param {string|null} slug  the plan slug THIS draw created -- the SOLE directory found under
 *   `.somi/plans/` (corrected 2026-08-12, review pass 1 Blocker F-43: keying on `decisions.md`'s
 *   presence left `slug` null on the conforming DECISIONS-NEEDED pause `agents/planner.md`
 *   mandates). `null` on zero or more than one such directory: the allowlist then falls back to
 *   the broad `.somi/plans/` prefix rather than rejecting every write -- a false `fail` on a
 *   gating dimension is worse than the over-permissiveness the narrowing replaces, and this is the
 *   ONLY fallback path (`decisions.md#d11`'s correction, plan review pass 4).
 * @returns {{ok:boolean, offenders:string[]}}
 */
export function boundaryRespected(changed, { slug = null } = {}) {
  // Named as a CATEGORY, not a hand-maintained exception list. Two successive drafts of the
  // criterion failed a conforming run by omitting one such path -- first .somi/README.md, then
  // .somi/somi-state/ -- which is what a prohibition-plus-exceptions shape keeps producing.
  //
  // The plans entry is a PLAIN PREFIX TEST, not a regex (corrected 2026-08-12, review pass 1
  // Blocker F-44: `slug` is a directory name the CANDIDATE wrote, and interpolating it unescaped
  // into `new RegExp` throws on `fix(auth`, false-fails the draw's own write on `plan[1]`, and
  // over-matches on `a.b` -- verified in all three directions). `startsWith` needs no escaping and
  // is closed and complete for the actual draw when a slug is known. Also fixes the Minor
  // `decisions.md#d11` names: `slug` was accepted and never used, so the allowlist matched ANY
  // `.somi/plans/` directory.
  const plansPrefix = slug ? `.somi/plans/${slug}/` : '.somi/plans/';
  const allowed = [
    /^\.somi\/README\.md$/,             // commands/plan.md writes it when absent
    /^\.somi\/audit\.log$/,             // PostToolUse, every turn
    /^\.somi\/somi-state\//,            // UserPromptSubmit, every turn
    /^\.claude\//,                      // the installed definition set, not candidate output
  ];
  const offenders = changed
    .map((c) => (typeof c === 'string' ? c : c.path))
    .filter(Boolean)
    .filter((p) => !p.startsWith(plansPrefix) && !allowed.some((rx) => rx.test(p)));
  return { ok: offenders.length === 0, offenders };
}

/** The load-bearing half, asserted separately so its failure names itself. */
export function noSourceTouched(changed) {
  const src = changed
    .map((c) => (typeof c === 'string' ? c : c.path))
    .filter((p) => p && /^(src|lib|app)\//.test(p));
  return { ok: src.length === 0, offenders: src };
}

/**
 * Task 02 criterion 2 (S3): whether `src/auth/session.mjs` was touched.
 *
 * REPORT-ONLY, not gating (`decisions.md#d11`'s correction) -- mechanical only for the "untouched"
 * half; "touched with a stated reason" needs prose this check cannot see. Two candidate splits were
 * considered and rejected -- see `phases/02-executable-criteria-gate.md`, iteration 2.1. This
 * function's result is therefore never wired into a criterion's `.verdict` -- the CALLER
 * (`runOnce()`) folds it into the evidence string handed to `judge()` before the judge runs, so the
 * judge actually weighs it (corrected 2026-08-12, review pass 1 Major F-45: a prior version
 * appended it to the judge's own evidence field AFTER `judge()` had already returned, which no
 * comment calling it "evidence for the judge" could make true). This function itself only computes
 * the fact; it does not know how or when a caller uses it.
 */
export function sessionUntouched(changed) {
  const touched = changed
    .map((c) => (typeof c === 'string' ? c : c.path))
    .some((p) => p === 'src/auth/session.mjs');
  return { ok: !touched, touched };
}
