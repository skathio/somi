---
description: Pre-release gate. Deterministic aggregation over the artifacts (work items done? open Blockers/Majors in the findings ledgers? DoD satisfied? rollout/rollback real?) plus ONE MAX review of the integration surface. Produces a release verdict + draft release notes.
argument-hint: <slug…> | <milestone/tag description>  (empty = all non-done work items in scope)
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit
model: sonnet
---

# /release-readiness — The pre-release gate

You are running the **release-readiness check**: is this set of work actually ready to ship?
Most of this is **deterministic aggregation over artifacts that already exist** — the model
spend goes to exactly one place: a fresh-eyes review of the *integration surface*, which
per-iteration reviews structurally miss.

Scope: **$ARGUMENTS** (one or more work-item slugs, or a milestone description; empty = every
work item in `.somi/plans/` not marked `done`+merged).

## Stage 1 — Deterministic checklist (no judgment, no model spend)

For each in-scope work item, check mechanically and record pass/fail + evidence:

| Check | Source |
|---|---|
| All phases/iterations `done` | `progress.md` tables |
| No `open` Blocker/Major findings | `node scripts/somi-findings.mjs open --slug <slug>` |
| No decisions outstanding | `progress.md` "Decisions outstanding" |
| Work-item DoD satisfiable | `spec.md` §12 checkboxes vs. reality (tests green? docs updated?) |
| Rollout & rollback sections real | `spec.md` §10 — non-empty, names a flag/metric, rollback is executable not aspirational |
| Security items landed, not deferred | `spec.md` §8 mitigations vs. the diffs; `security-reviewer` consulted where §8 gated it |
| No interrupted loops | `.claude/somi-state/loop/*.json` with `status: running` for in-scope slugs |
| Follow-ups triaged | `progress.md` follow-ups each either scheduled or explicitly accepted for post-release |
| Working tree honest | `node scripts/somi-check.mjs --all` (secrets, lockfile hand-edits, loose ends) |

Any hard failure here (open Blocker, red tests, unexecutable rollback) → the verdict is already
`not-ready`; finish the checklist anyway so the report is complete, but say it early.

## Stage 2 — MAX integration review (the one expensive step)

Per-iteration reviews saw each diff in isolation. Task the [`reviewer`](../agents/reviewer.md)
(`opus`, fresh context) on the **cumulative release diff** (merge-base of the release scope vs.
the default branch) with an explicit integration framing: interactions **between** the work
items, contract mismatches across independently-reviewed changes, migration ordering across
items, config/flag interactions, and observability of the release as a whole ("when this ships
and something degrades, what tells us which work item did it?"). Skip only if the release is a
single already-panel-reviewed work item.

Record its findings into the ledger(s) (`somi-findings.mjs record`) like any review.

## Stage 3 — Verdict + release notes

Write `.somi/reviews/_ad-hoc/<YYYY-MM-DD>-release-<verdict>.md` (or under the single slug when
scope is one work item) using [`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl) framing:

- **Verdict**: `ready` / `ready-with-conditions` (name them — each with an owner) / `not-ready`
  (the blocking list, each with its fastest path to green).
- The Stage 1 table with evidence, and Stage 2's findings.
- **Draft release notes**, generated from the work items' spec §1 framings and diary
  plan-change entries — what shipped, what changed along the way, migration/operator notes
  (from spec §10). Mark it a draft for human editing.

Summarise back: verdict first, then the two or three load-bearing facts behind it, pointers.

## Guardrails

- **The checklist cannot be argued green.** A failed deterministic check is a fact; the model
  doesn't soften it to `ready-with-conditions` without a named human owner for each condition.
- **Read-only against the release** — this command gates, it doesn't fix. Fixes go through
  `/code` / `/debug` on the owning work item.
- **One MAX pass, deliberately.** The economics of this command are the checklist doing 90% of
  the work for free; don't Task a panel per work item — the per-iteration reviews already ran.
