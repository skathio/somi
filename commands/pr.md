---
description: Compose a PR title + description from a work item's artifacts (spec/rca, verified decisions, progress, review verdicts, open findings, diary highlights) and optionally open it via gh. The exit ramp from .somi/ artifacts into the team's PR workflow.
argument-hint: <slug> [--draft]
allowed-tools: Read, Grep, Glob, Bash
model: sonnet
---

# /pr — Work item → pull request handoff

You are composing a **pull-request description from a work item's artifacts**. The `.somi/`
artifact set already explains what was built and why — this command turns it into the PR the
team actually reviews, instead of leaving the author to retype it.

Target work item: **$ARGUMENTS** (a slug under `.somi/plans/`; empty = the single work item with
`status: in-progress` or `done`-but-unmerged, else ask).

## What to do

### 1. Gather (read-only)

From `.somi/plans/<slug>/`:

- `spec.md` §1 (purpose) and §4 (goals/non-goals) — or **`rca.md`** for a `/debug` work item
  (symptom + root cause + fix are the story).
- `decisions.md` — the **live** verified decisions, one-liners only.
- `progress.md` — phases/iterations completed; follow-ups filed.
- `diary.md` — plan-change entries only (the "what changed along the way" a reviewer needs).
- `.somi/reviews/<slug>/` — the latest verdict per iteration; plus
  `node scripts/somi-findings.mjs open --slug <slug>` for anything still open.
- `git log` / `git diff` against the default branch for the actual change summary and test files.

### 2. Compose

```markdown
## What & why
<2–4 sentences from spec §1 / rca.md — the problem and the outcome, not a file list.>

## How
<The approach in one short paragraph + the verified decisions as bullets:
- D2 — Redis-backed counters (multi-replica budget) — .somi/plans/<slug>/decisions.md>

## What changed along the way
<Only if plan-change diary entries exist — one line each. Omit the section otherwise.>

## Testing
<Tests added/changed and what they prove; for /debug items, name the regression test.>

## Review status
<Latest SoMi verdict(s); open findings by id with their agreed disposition
("F-4 accepted as follow-up — see progress.md"). Never hide an open Major.>

## Follow-ups
<From progress.md, one line each. Omit if none.>
```

Title: `<type>: <spec §1 in imperative, ≤ 70 chars>` following the repo's commit/PR conventions
(read a few merged PRs / `git log` for house style; repo conventions win over this template).

Keep it honest and short — the PR description is the artifact set *distilled*, not duplicated.
Link `.somi/plans/<slug>/` once for readers who want the full record. Do **not** paste user
problem statements out of their fences; reference `context.md` instead.

### 3. Confirm, then optionally open

Show the composed title + body to the user. **Opening a PR is outward-facing — only run
`gh pr create` after the user confirms** (use `--draft` if they asked for a draft, and their
base branch if named). No `gh` available or user declines → hand them the composed markdown to
paste. Never push branches or create the PR unprompted.

### 4. After opening (if opened)

- Append a `diary.md` entry (category `note`): `PR opened: <url>`.
- Add a `progress.md` "Recent activity" line with the PR URL.

## Guardrails

- **Confirmation before `gh pr create` — always.** Publishing is not reversible in the way a
  local edit is.
- **Report reality.** If tests are red, findings are open, or iterations are incomplete, the PR
  description says so — a handoff that hides state is worse than none.
- **House style wins.** If the repo has a PR template (`.github/PULL_REQUEST_TEMPLATE.md`), fill
  *that*, mapping the sections above into it rather than fighting it.
