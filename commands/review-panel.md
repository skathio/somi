---
description: Parallel multi-lens review. Spawns the relevant review agents (reviewer + security / architecture / test as the diff warrants) concurrently on the same change, then merges and de-duplicates their findings into one severity-graded verdict.
argument-hint: <slug> [phase N, iteration M]  |  <diff target>
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit, WebFetch
model: sonnet
---

# /review-panel — Parallel multi-lens review

You are running the **review panel** of somi: several independent, read-only review lenses on the
**same change at the same time**, merged into one verdict.

The user's target: **$ARGUMENTS** (a work-item slug, optionally `phase N, iteration M`, or a diff
target such as a PR / commit range / working tree).

The orchestrator (this command) is `sonnet`; each lens it Tasks (`reviewer`, `security-reviewer`,
`architecture-reviewer`, `test-strategist`) remains `opus`. The lenses are **read-only** — they
return findings; this command owns every write (the merged review file, `progress.md`, `diary.md`).

> **Why this exists.** A single reviewer carries one set of priorities at a time; running the
> specialist lenses *in parallel* on one diff catches what a sequential, escalation-only pass misses
> — and it's safe to parallelize because every lens is read-only, so there is no write contention.
> This is the panel for a change you want scrutinized hard before merge. For a quick single-lens
> pass, use [`/review`](./review.md).

## When to use this vs. `/review`

- **`/review`** — the default. One skeptical reviewer; fast; right for most iterations.
- **`/review-panel`** — when the change is high-stakes, crosses several concerns at once (touches
  auth *and* a new contract *and* the test shape), or is about to merge to a protected branch. More
  model spend; broader coverage.

## What to do

### 1. Resolve the target and the diff

Same resolution as [`/review`](./review.md): if a `<slug>` (and optional `phase N, iteration M`) is
given, read the work-item artifact set and scope to that iteration's diff; otherwise scope to the
given diff target (PR, commit range, or working tree). Capture the diff once and reuse it for every
lens so they all review the identical change.

### 2. Select the lenses (which panelists sit for this review)

Always seat **`reviewer`** (the generalist). Seat a specialist **only when the diff actually engages
its domain** — seating an irrelevant lens is wasted spend and dilutes signal:

| Lens | Seat it when the diff… |
|---|---|
| `reviewer` | always |
| `security-reviewer` | touches auth/authz, crypto, secrets, input validation, deserialization, file uploads, third-party data, templating, or user-controlled input reaching a sink |
| `architecture-reviewer` | adds/splits a module or service, changes a public contract, or changes dependency direction |
| `test-strategist` | adds/changes meaningful test surface, or the diff's risk is concentrated where tests are thin/over-mocked/flaky |

Record which lenses you seated and **why each unseated one was skipped** — that record is part of
the panel's value (it shows the surface was considered, not ignored).

### 3. Run the panel **in parallel**

Issue the seated lenses as **multiple `Task` calls in a single turn** so they run concurrently. Give
each the *same* scoped diff and work-item context, and each its own briefing:

```text
Task reviewer            (= /review <target>, scope = this diff)
Task security-reviewer   (= security lens on this diff)            # if seated
Task architecture-reviewer (= structural lens on this diff)        # if seated
Task test-strategist     (= test-shape lens on this diff)          # if seated
```

> **Copilot / sequential fallback.** Parallel sub-agent execution is a Claude Code capability. Where
> the host can't run sub-agents concurrently (e.g. the GitHub Copilot extension), seat the same
> lenses and run them **one after another** — the merged result is identical, only slower. Never drop
> a lens to save a round trip.

### 4. Merge and de-duplicate the findings

Collect every lens's findings into one list, then reconcile:

- **De-duplicate** findings that multiple lenses raise. Two findings are the same when they share a
  locus (file + symbol/function, **not** raw line number — lines drift) and the same underlying
  problem. Collapse them into one entry and **credit every lens that raised it** ("flagged by
  reviewer + security-reviewer") — independent agreement is signal; surface it.
- **Reconcile severity** to the **highest** any lens assigned (a security `Blocker` wins over a
  generalist `Minor` on the same issue). Reconcile confidence to the highest.
- **Surface disagreement** explicitly. If one lens approves an area another flags as a Blocker, that
  conflict is itself a finding — present both positions; do not average them away.
- **Order** by severity then confidence. Lead with Blockers. Don't let fifteen Nits bury one Blocker.

### 5. Compute the panel verdict

The merged verdict is the **most severe** lens verdict (any `reject` → `reject`; else any
`request-changes` → `request-changes`; else `approve-with-comments` if any comments; else
`approve`). A security or architecture Blocker sets the verdict regardless of how clean the other
lenses found the change.

### 6. Write the merged review and update state

- Write the merged review to
  `.somi/reviews/<slug>/<YYYY-MM-DD>-<phase>.<iter>-panel-<verdict>.md` (work-item-scoped) using
  [`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl), with a **Panel** header noting which
  lenses sat and which were skipped (and why).
- Record the **merged, de-duplicated** findings in the ledger
  (`echo '<findings JSON array>' | node scripts/somi-findings.mjs record --slug <slug> --review
  <review-filename>`) and resolve any previously-open findings the panel confirmed fixed — same
  protocol as [`/review`](./review.md) §6. Record each finding once (post-merge), crediting the
  lenses in the markdown, not as duplicate ledger entries.
- Update `progress.md` (the iteration's `Reviewed` column → `panel:<verdict>`) and append a
  `diary.md` entry (category `review-feedback`) naming the verdict, the seated lenses, and the top
  finding. The lenses are read-only; these writes are yours.
- If any lens surfaced a **plan** issue (not just code), include its proposed diary entry and
  recommend `/plan` (or the `/code` plan-change protocol) per [`/review`](./review.md).

### 7. Summarise back

- **Verdict** + count by severity (merged, de-duplicated).
- **Lenses seated** and **skipped (with reason)**.
- **Top findings** — lead with any Blocker; note which were raised by more than one lens.
- **Disagreements** between lenses, if any.
- Pointer to the merged review file. Next step (usually: address Blockers/Majors via `/code`, or
  merge if clean).

## Guardrails

- **Same diff for every lens.** Capture it once; don't let lenses review drifting working trees.
- **Read-only lenses; orchestrator writes.** Identical to `/review` — the agents return text, this
  command persists. Never let a lens write the review file.
- **Don't seat irrelevant lenses.** Coverage is seating the *right* panel, not the *largest* one.
- **Don't average away a Blocker.** Highest severity wins; disagreement is surfaced, not smoothed.
- **De-dupe on locus, not line number.** The same issue at a shifted line is one finding.
