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
 * @param {string} slug  the plan slug the run created, if any
 * @returns {{ok:boolean, offenders:string[]}}
 */
export function boundaryRespected(changed, { slug = null } = {}) {
  // Named as a CATEGORY, not a hand-maintained exception list. Two successive drafts of the
  // criterion failed a conforming run by omitting one such path -- first .somi/README.md, then
  // .somi/somi-state/ -- which is what a prohibition-plus-exceptions shape keeps producing.
  const allowed = [
    /^\.somi\/plans\//,                 // the permitted target
    /^\.somi\/README\.md$/,             // commands/plan.md writes it when absent
    /^\.somi\/audit\.log$/,             // PostToolUse, every turn
    /^\.somi\/somi-state\//,            // UserPromptSubmit, every turn
    /^\.claude\//,                      // the installed definition set, not candidate output
  ];
  const offenders = changed
    .map((c) => (typeof c === 'string' ? c : c.path))
    .filter(Boolean)
    .filter((p) => !allowed.some((rx) => rx.test(p)));
  return { ok: offenders.length === 0, offenders };
}

/** The load-bearing half, asserted separately so its failure names itself. */
export function noSourceTouched(changed) {
  const src = changed
    .map((c) => (typeof c === 'string' ? c : c.path))
    .filter((p) => p && /^(src|lib|app)\//.test(p));
  return { ok: src.length === 0, offenders: src };
}
