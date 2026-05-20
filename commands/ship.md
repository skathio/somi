---
description: Full plan → code → review pipeline against a single problem statement. Stops between stages for human approval.
argument-hint: <problem statement>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: opus
---

# /ship — End-to-end engineering pipeline

You are running the **full pipeline** of somi-ai: plan → code → review, with human-in-the-loop
gates between stages.

The user's problem statement: **$ARGUMENTS**

## Pipeline stages

### Stage 1 — Plan

1. Invoke the `/plan` flow (same logic as [`commands/plan.md`](./plan.md)) with `$ARGUMENTS`.
2. Produce `PLAN.md`.
3. **STOP.** Present the summary. Explicitly ask:
   > "Plan ready. Reply `approve` to proceed to Stage 2 (coding the first iteration), `revise <notes>`
   > to iterate on the plan, or `abort` to stop."

Do **not** proceed without an explicit `approve`.

### Stage 2 — Code (one iteration at a time)

When the user approves, code **one iteration** at a time. Default to phase 1, iteration 1.

1. Invoke the `/code` flow.
2. Produce the diff + tests.
3. **STOP.** Present the summary. Explicitly ask:
   > "Iteration <N> implemented. Reply `review` to invoke the reviewer on this iteration, `next` to
   > proceed to the next iteration without a review (not recommended for non-trivial iterations), or
   > `stop` to pause the pipeline."

Default behavior is to review every iteration. The user can override.

### Stage 3 — Review

1. Invoke the `/review` flow against the current iteration's diff.
2. Produce `REVIEW.md` for this iteration.
3. **STOP.** Present the verdict + top findings.
   - If verdict is `approve`: ask "Reply `next` to proceed to the next iteration, or `stop` to pause."
   - If verdict is `approve-with-comments`: same as approve, but list the Minors the user may want to
     address.
   - If verdict is `request-changes` or `reject`: loop back to Stage 2 with the findings as the brief.

## Guardrails

- **Hard stops between stages.** No silent progression. The user must say yes.
- **One iteration per coding cycle.** Even if the plan has 5 iterations, you do not blast through them.
  Each gets its own code → review loop.
- **Re-plan on scope discovery.** If, during coding, the slice turns out to be wrong-sized, pause the
  pipeline and re-plan rather than ship a wrong-shaped iteration.
- **Stop the pipeline on any Blocker finding** until it's resolved. Do not paper over.

## Why a pipeline command exists

Running `/plan`, `/code`, `/review` manually is correct and idiomatic. `/ship` exists for users who want
the full ceremony in one entrypoint with explicit gates — it does **not** skip review or rubber-stamp;
it just removes the boilerplate of typing the commands separately.
