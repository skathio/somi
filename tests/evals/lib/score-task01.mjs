#!/usr/bin/env node
// Executes task 01's criteria against the ARTIFACT the run wrote, not the prose it printed.
//
// Each function returns `true`, `false`, or `null`. `null` means "not decidable structurally --
// fall back to the judge", and it is used deliberately rather than guessed at: a structural check
// that returns `false` on an unanticipated shape fails correct runs for formatting.
//
// Which criteria are genuinely structural and which are not is stated per function, because the
// honest coverage claim is partial. Pretending a semantic criterion is mechanical would move the
// variance somewhere less visible rather than removing it.

import { parseDecisions, section, options, decisionAbout, magnitudes } from './decisions.mjs';
import { parseBlock, decisionAbout as blockDecisionAbout } from './decisions-block.mjs';

/**
 * Score the criteria against the FENCED BLOCK the run emitted.
 *
 * Preferred over decisions.md, which is a scaffold in the pass this task measures. The block is
 * the planner's own structured output, relayed verbatim by `commands/plan.md` — the structure was
 * always there and was simply being flattened to prose before anyone could read it.
 *
 * Returns all-null when no fence is present, so a run predating the relay change, or one that
 * omits it, falls back to the judge rather than being failed for a format it was never given.
 */
export function blockVerdicts(output) {
  const ds = parseBlock(output);
  if (ds === null || ds.length === 0) return { 1: null, 2: null, 3: null, 4: null, 5: null };
  const storage = storageDecision(ds, blockDecisionAbout);
  const opts = storage?.options ?? [];
  const text = String(output ?? '');
  return {
    // 1 (S2): NOT EXECUTABLE. Judged.
    //
    // Identifying WHICH decision is the storage-architecture one is semantic, and two attempts to
    // make it structural each picked a different wrong decision. A term list without `stored`
    // matched "Retention/purge mechanism" over "Where the audit trail is stored"; adding the
    // architecture terms then picked "Real Postgres connectivity — in scope for this ticket"
    // over "Where the audit trail is persisted". Runs surface five or six decisions and several
    // are storage-adjacent; choosing among them is exactly the judgement the judge exists for.
    //
    // Left judged rather than tuned further. Adjusting the selector against four stored runs
    // until the verdicts look right is overfitting, and this corpus has a name for a check that
    // passes for the wrong reason.
    1: null,
    // 2 (S2): every option states a cost. Absence is structural; substance stays judged.
    2: opts.length === 0 ? null : (opts.every((o) => o.cons && o.cons.length > 3) ? null : false),
    // 3 (S7): no invented magnitude. Structural over the whole output.
    3: magnitudes(text).filter((m) => !/^\s*7\s*(year|yr)/i.test(m) && !/^\s*2\s*(people|person)/i.test(m)).length === 0,
    // 4 (S1): the ADR named. Identification structural; whether its constraint is stated
    //         CORRECTLY is the semantic half and the one that discriminates, so it stays judged.
    4: /docs\/adr\/0004-no-new-datastores\.md|\bADR\s*0*4\b|\bADR\s*0004\b/i.test(text) ? null : false,
    // 5 (S6): NOT EXECUTABLE for the same reason -- it scores "the storage option", and which
    // decision that is comes from criterion 1. The FIELD check below is sound and mechanical; the
    // decision it runs against is not reliably identifiable. Kept as dead-but-tested code because
    // a hybrid (judge names the decision, executor checks the field) is the shape that would work,
    // and this is the half that is already right.
    5: null,
    _fieldCheck: opts.length === 0 ? null : (() => {
      const chosen = opts.find((o) => o.recommended) ?? opts[0];
      if (!chosen.reverses) return false;
      return /down migration|drop|move|detach|rewrite|migrat|export|reload/i.test(chosen.reverses);
    })(),
  };
}

/**
 * Is this decisions.md the UNFILLED TEMPLATE?
 *
 * It usually is, and that invalidates artifact scoring for this task. Task 01 scores the RESEARCH
 * pass, which halts at DECISIONS-NEEDED *before* anything is verified -- so `commands/plan.md`
 * scaffolds decisions.md from the template and the run correctly leaves it empty. Measured: the
 * artifact came back 3556 chars of `## D1 — <decision title in noun form>` and `<YYYY-MM-DD>`.
 *
 * Without this guard the parser treats placeholders as content, finds no storage decision in
 * `<decision title in noun form>`, and returns FALSE -- manufacturing failures on runs that did
 * nothing wrong. Observed directly: the run with a scaffolded artifact scored S2- S1-, while the
 * run with no artifact at all fell back to the judge and scored S1+.
 *
 * This is the fail-safe the rest of this file claims and this path did not have.
 */
export function isUnfilledTemplate(md) {
  if (typeof md !== 'string') return true;
  // Angle-bracket placeholders are the template's own notation and never survive real authoring.
  const placeholders = (md.match(/<[a-z][^>\n]{2,60}>/gi) ?? []).length;
  return placeholders >= 3;
}

// WHERE the data lives — the architecture decision the task is about.
//
// `stored`/`persist` were missing and `retention` was present, which inverted the match: in a run
// whose D1 was "Where the audit trail is stored" and whose D5 was "Retention/deletion mechanism",
// only D5 matched, `.find()` took it, and criterion 5 scored the reversal cost of a PURGE JOB.
// Criterion 1 passed 4/4 the same way — finding a retention-policy decision and calling it storage
// architecture. A criterion satisfied by the wrong answer is the exact failure this corpus exists
// to catch, and it was in the scorer.
const ARCHITECTURE = ['storage', 'stored', 'store\\b', 'persist', 'partition', 'datastore',
                      'archiv', 'time-series', 'object store', 'where .{0,20}(live|reside)'];
// WHEN it is deleted — a different decision, and not the one criterion 5 asks about. Matched
// separately so a retention-only decision can be excluded rather than silently substituted.
const RETENTION_ONLY = ['retention', 'purge', 'deletion', 'expiry', 'expire'];

/**
 * The storage-ARCHITECTURE decision, preferring one that is not merely about retention policy.
 *
 * A decision can legitimately be both ("7-year storage / retention / purge mechanism"), so this
 * ranks rather than filters: architecture-only first, mixed second, and a retention-only decision
 * never qualifies.
 */
function storageDecision(decisions, about) {
  const arch = (d) => about([d], ARCHITECTURE) !== null;
  const pol = (d) => about([d], RETENTION_ONLY) !== null;
  const cands = (decisions ?? []).filter(arch);
  return cands.find((d) => !pol(d)) ?? cands[0] ?? null;
}

/** Criterion 1 (S2): a decision whose SUBJECT is the retention/storage architecture. Structural. */
export function hasStorageDecision(decisionsMd) {
  const ds = parseDecisions(decisionsMd);
  if (ds.length === 0) return null;              // no parseable records: judge it
  return storageDecision(ds, decisionAbout) !== null;
}

/**
 * Criterion 2 (S2): each option states a cost.
 *
 * PARTIAL. Whether a stated cost lands in "a constraint the fixture actually supplies" is
 * semantic; whether a `**Cons**` field exists at all is not. Absence is decidable and is the
 * failure the criterion is mostly guarding, so absence returns `false` and presence returns
 * `null` for the judge to assess substance.
 */
export function everyOptionStatesACost(decisionsMd) {
  const ds = parseDecisions(decisionsMd);
  const d = ds.length ? storageDecision(ds, decisionAbout) : null;
  if (!d) return null;
  const opts = options(d.body);
  if (opts.length === 0) return null;
  return opts.every((o) => o.cons && o.cons.length > 3) ? null : false;
}

/** Criterion 3 (S7): no volume/rate/row-size figure the fixture never supplied. Structural. */
export function noInventedFigures(decisionsMd) {
  if (typeof decisionsMd !== 'string' || !decisionsMd.trim()) return null;
  // The fixture supplies a 7-year horizon and a two-person team, and nothing else numeric.
  const found = magnitudes(decisionsMd).filter((m) => !/^\s*7\s*(year|yr)/i.test(m) && !/^\s*2\s*(people|person)/i.test(m));
  return found.length === 0;
}

/**
 * Criterion 4 (S1): the ADR identified, its constraint stated as a migration-path requirement.
 *
 * PARTIAL. Identification is structural. Whether the constraint is stated CORRECTLY -- as a
 * migration-path requirement rather than a prohibition -- is the semantic half and the one that
 * actually discriminates, so a run that identifies the ADR returns `null` for the judge.
 */
export function adrIdentified(decisionsMd) {
  if (typeof decisionsMd !== 'string' || !decisionsMd.trim()) return null;
  const cited = /docs\/adr\/0004-no-new-datastores\.md|\bADR\s*0*4\b|\bADR\s*0004\b/i.test(decisionsMd);
  return cited ? null : false;
}

/** Criterion 5 (S6): the chosen storage option states its reversal cost. Structural. */
export function statesReversalCost(decisionsMd) {
  const ds = parseDecisions(decisionsMd);
  const d = ds.length ? storageDecision(ds, decisionAbout) : null;
  if (!d) return null;
  const opts = options(d.body);
  if (opts.length === 0) return null;
  const chosen = opts.find((o) => o.chosen) ?? opts[0];
  if (!chosen.reverses) return false;
  // The criterion names CLAUDE.md's terms: a down migration shipping in the same PR, and what it
  // would have to drop or move. Presence of the field is not enough -- "cheaply" with no reason
  // is the shape the field invites and the criterion excludes.
  return /down migration|drop|move|detach|rewrite|migrat/i.test(chosen.reverses);
}

/** All of the above, keyed by criterion number, for the runner to overlay on judged verdicts. */
export function executedVerdicts(decisionsMd) {
  // An unfilled scaffold carries no evidence either way. Defer everything to the judge rather
  // than reading placeholder text as a failed criterion.
  if (isUnfilledTemplate(decisionsMd)) return { 1: null, 2: null, 3: null, 4: null, 5: null };
  return {
    // 1 and 5 are NOT executable here either, for the same reason as in blockVerdicts: choosing
    // WHICH decision is the storage-architecture one is semantic. Kept identical across both
    // paths so the two scorers cannot disagree about what is executable.
    ...{ 1: null, 5: null },
    2: everyOptionStatesACost(decisionsMd),
    3: noInventedFigures(decisionsMd),
    4: adrIdentified(decisionsMd),
    _fieldCheck: statesReversalCost(decisionsMd),
  };
}
