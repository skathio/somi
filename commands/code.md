---
description: Execute against an approved plan with senior-level design judgment. Specify the iteration to run (e.g. `phase 1, iteration 2`) or pass a free-form task if no plan exists for a small change.
argument-hint: <iteration ref or task description>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: opus
---

# /code — Coding workflow

You are running the **coding workflow** of somi-ai.

The user's request: **$ARGUMENTS**

## What to do

1. **Look for a plan.** Read `PLAN.md` (or the specific plan file referenced by the user). If `$ARGUMENTS`
   refers to a phase/iteration, locate it in the plan.
   - If no plan exists and the work is **trivial and self-contained** (one file, one purpose), proceed.
   - If no plan exists and the work is **non-trivial**, stop and recommend `/plan` first. Do not start
     coding non-trivial work without a plan.
2. **Brief the `coder` agent** via the Task tool. Pass:
   - The plan section being executed (or the task description).
   - Any context from the current conversation that is relevant.
   - Explicit reminders to follow the plan and to surface scope changes rather than absorb them silently.
3. **The coder executes** — reads, edits, writes, and runs tests.
4. **Verify** by running tests yourself if the agent didn't, or by inspecting the diff. Do not declare
   done on the agent's word alone.
5. **Summarize back** to the user with:
   - The plan iteration that was implemented.
   - Files changed and one-line summaries.
   - Tests added/changed.
   - Anything **not done** with reason.
   - Anything that crossed into security/architecture territory — and whether `security-reviewer` /
     `architecture-reviewer` should be invoked before `/review`.
   - A specific next step: "Run `/review` to validate before merging."

## Guardrails

- **No drive-by refactors.** If the coder spots improvements outside the iteration, log them as
  follow-ups; don't ship them in this diff.
- **No widening scope without confirmation.** If the plan's slice turns out to be wrong-sized, stop and
  re-plan.
- **No silent compromises.** If a test was skipped, a check disabled, or a shortcut taken, name it
  explicitly in the summary.
- **Tests must be runnable and green** before declaring done. If they can't be run in this environment,
  say so.

## Quality bar

See [`agents/coder.md`](../agents/coder.md) — bullet list: matched the iteration, tests green, no leftover
debug, no scope drift, surfaced any tradeoffs.
