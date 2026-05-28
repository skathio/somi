---
description: Targeted architectural review of a change, plan, or ADR. Evaluates boundaries, contracts, dependency direction, and reversibility on a years-long horizon. Output lands under .somi/reviews/<slug>/ when scoped to a work item.
argument-hint: <slug> | <diff range> | <PR #> | <file path> | "plan <slug>"
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit, WebFetch
model: sonnet
---

# /architecture-review — Targeted architectural review

You are running an **architecture-only** review using somi-ai.

Target: **$ARGUMENTS** (empty = current working-tree diff vs. default branch, scoped to a single
in-progress work item if exactly one exists).

## When to invoke

Always when the change introduces or modifies any of:

- A new module, package, or service.
- A public contract (HTTP / RPC / library API / event schema).
- A dependency-direction change, especially at the domain↔infrastructure boundary.
- An ADR or design doc choosing between patterns (sync/async, monolith/service, push/pull).
- A module split or merge.

If the change is purely internal refactoring within an existing module with no contract change,
`/review` (which still invokes the reviewer with arch awareness) is usually enough — this command
is for cases where structure is the primary subject.

## What to do

### 1. Resolve the target

Use the same resolution logic as [`/review`](./review.md): slug, working tree, range, PR, file,
or `plan <slug>`.

### 2. Brief the `architecture-reviewer` agent

Via the Task tool, pass:

- The diff or plan-artifact set.
- The work-item paths (`spec.md`, `decisions.md`, the iteration phase file, recent `diary.md`
  entries) when scoped.
- The expectation: restate the decision, identify forces, locate boundaries, trace dependencies,
  stress-test the contract against three plausible future requirements, check reversibility, check
  team fit.

The `architecture-reviewer` agent is read-only (Read/Grep/Glob). Have it **return** its findings;
the command owns all writes.

### 3. Findings must include

- **What's being decided** — the reviewer's restatement.
- **Forces evaluated** — the constraints/requirements being weighed.
- **Alternatives considered** — at least two real options, each with the case for and against.
- **Verdict** — `approve` / `approve-with-changes` / `request-changes` / `reject`.
- **Findings** — severity-graded (same scale as `/review`).
- **Reversibility note** — how hard to undo in 18 months and what would force it.
- **Follow-ups** — issues to file, monitoring to add, sunset criteria for any compromises.

If the architecture has security implications, the command **must** also invoke
`security-reviewer` via Task and merge those findings.

### 4. Write the review

Filename pattern: `<YYYY-MM-DD>-arch-<phase>.<iter>-<verdict>.md` under
`.somi/reviews/<slug>/` when scoped, or `.somi/reviews/_ad-hoc/<YYYY-MM-DD>-arch-<slug>.md`
otherwise.

Use [`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl) with architecture framing, or
[`templates/ADR.md.tmpl`](../templates/ADR.md.tmpl) if the target is a single ADR.

### 5. Update work-item state (if scoped)

- `progress.md`: append a line under "Recent activity" referencing the architecture review and verdict.
- If a Blocker / Major requires a plan change (e.g., a chosen pattern doesn't fit the boundary),
  append a `review-feedback` diary entry. The follow-up `/plan` revision (or `/code`'s plan-change
  protocol) will apply changes.

### 6. Summarise back

- **Verdict**.
- Count of Blockers / Majors / Minors.
- Top 3 findings with reversibility cost.
- Pointer to the review file.

## Guardrails

- **No architecture astronautics.** Don't propose patterns the problem doesn't call for.
- **Treat low-reversibility decisions with tighter scrutiny.** A public contract is forever
  until explicitly versioned out; a private helper can be rewritten in an afternoon.
- **Team fit matters.** A "correct" architecture nobody can run is incorrect.
- **Don't pattern-match to the last system you saw.** Each codebase has its own forces.
