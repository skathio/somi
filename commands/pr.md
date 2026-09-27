---
description: Compose a PR title + description from a work item's artifacts (spec/rca, verified decisions, progress, review verdicts, open findings, diary highlights) and optionally open it via gh. The exit ramp from .somi/ artifacts into the team's PR workflow.
argument-hint: <slug> [--draft]
allowed-tools: Task, Read, Bash, Write, Edit
---

# /pr — Work item → pull request handoff

You are running the **PR handoff** workflow of somi: turning a work item's `.somi/` artifact set
into the PR description the team actually reviews, instead of leaving the author to retype it.

Target work item: **$ARGUMENTS** (a slug under `.somi/plans/`; empty = the single work item with
`status: in-progress` or `done`-but-unmerged, else ask).

## What to do

1. **Brief the `pr` agent** ([`agents/pr.md`](../agents/pr.md)) with the resolved slug. It gathers
   the artifacts itself and returns a composed title + body — it never writes or publishes
   anything; this command owns every write, including `gh pr create`.
2. **Show the composed title + body to the user.** Opening a PR is outward-facing — only run
   `gh pr create` after the user confirms (use `--draft` if they asked for a draft, and their
   base branch if named). No `gh` available or the user declines → hand them the composed
   markdown to paste. Never push branches or create the PR unprompted.
3. **After opening (if opened)**:
   - Append a `diary.md` entry (category `note`): `PR opened: <url>`.
   - Add a `progress.md` "Recent activity" line with the PR URL.

## Guardrails

- **Confirmation before `gh pr create` — always.** Publishing is not reversible the way a local
  edit is.
- **Report reality.** If the agent's composed description shows red tests, open findings, or
  incomplete iterations, don't soften it before showing the user.
