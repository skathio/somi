---
description: Produce a staff-engineer-grade implementation plan (phases, risks, slices, DoD, test & rollout strategy) for the given problem statement.
argument-hint: <problem statement>
allowed-tools: Task, Read, Grep, Glob, Write, WebFetch, Bash
model: opus
---

# /plan — Planning workflow

You are running the **planning workflow** of somi-ai.

The user's problem statement: **$ARGUMENTS**

## What to do

1. **Validate scope.** If `$ARGUMENTS` is empty or fundamentally unclear, ask the user for the problem
   statement before proceeding. Do not invent one.
2. **Invoke the `planner` agent** via the Task tool. Pass the full problem statement, plus any context
   from the current conversation that is relevant. The planner has its own system prompt
   ([`agents/planner.md`](../agents/planner.md)) — don't duplicate it; just brief the agent.
3. **The planner reads the repo as needed** (Read, Grep, Glob) and produces the plan body.
4. **Write the plan** to `PLAN.md` at the repo root, using [`templates/PLAN.md.tmpl`](../templates/PLAN.md.tmpl)
   as the shape. If `PLAN.md` already exists and is for a different problem, write to `PLAN-<short-slug>.md`
   instead and tell the user.
5. **Summarize back** to the user with:
   - One-paragraph problem framing.
   - Phase count and rough effort shape.
   - **Top 3 risks** and **top 3 open questions**.
   - A pointer to the plan file.
   - A specific next step: "Approve / edit / ask for revisions, then run `/code <phase>.<iteration>`."

## Guardrails

- Do not start coding. This command is plan-only. The user explicitly approves before any code runs.
- If the planner discovers the work is much larger than presented, return a **scoping note** and stop.
  Don't produce a credible-looking mega-plan for a request that needs to be broken up first.
- If the work intersects auth/crypto/PII or contract-breaking changes, the plan must explicitly call
  out which iteration triggers the `security-reviewer` or `architecture-reviewer` agents.

## Quality bar

The plan is acceptable when a different engineer could pick up phase 1, iteration 1 without asking
another question. See [`agents/planner.md`](../agents/planner.md) for the full quality bar.
