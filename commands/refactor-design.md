---
description: "Scope design for a refactor too big for one diff, done as a `cost: high` pass: names the destination shape, maps seams and risks across modules, confirms test-coverage gaps, and compiles a brief.md that /plan-loop → /code-loop execute. Split from /refactor because mode selection and tier selection are different decisions."
argument-hint: <refactor target too large for one safe diff>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob
model: opus
---

# /refactor-design — Large-refactor scope design

You are running the **refactor-designer** workflow of somi — the front-loaded, expensive-reasoning
step for a refactor too big for one safe diff: it spans many modules, needs a migration, or changes
a shared shape. Rather than editing, this command **designs the refactor scope** and compiles it
into a [`brief.md`](../templates/BRIEF.md.tmpl) that the cheaper tier executes via
[`/plan-loop`](./plan-loop.md) → [`/code-loop`](./code-loop.md).

> **Runs on the most capable model end-to-end**, like [`/design`](./design.md). This command has
> no `cost:` of its own — its `model:` is a separate, host-level selection — and Tasks the
> [`refactor-designer`](../agents/refactor-designer.md) agent for its entire job, which declares
> `cost: high` with no lower member. Split out from [`/refactor`](./refactor.md) because mode
> selection (surgical vs. scope design) and tier selection (`medium` vs. `high`) are two different
> decisions — one unit naming both let a declared tier become a claim its own procedure could
> contradict (a large refactor under a `medium` ceiling would have entered scope-design work at a
> tier its own text called insufficient). [`/refactor`](./refactor.md) stays the default for a
> small, named smell that fits one safe diff; use this command when the destination needs more
> than one reviewable diff.

The user's refactor target: **$ARGUMENTS**

## What to do

### 1. Validate scope

If the target is genuinely small enough for one safe diff, say so and recommend
[`/refactor`](./refactor.md) instead — don't manufacture a design pass for a surgical change.

### 2. Pick the slug and scaffold

Derive a short, plain-language kebab-case slug (e.g., `untangle-order-service`); confirm with the
user. Create `.somi/plans/<slug>/` with the same artifact set [`/design`](./design.md) uses, from
[`templates/`](../templates/): `design.md` (destination shape + seam/risk map), `decisions.md`
(ADR-style, user-verified), `brief.md` (the load-bearing design→execution handoff), `diary.md`.
`context.md`, `spec.md`, `phases/`, and `progress.md` are **the planner's** to create when
[`/plan`](./plan.md) runs. If `.somi/README.md` does not yet exist at the repo root, also write it
from [`templates/SOMI-README.md.tmpl`](../templates/SOMI-README.md.tmpl), same as `/design`.

### 3. Invoke the `refactor-designer` agent

Brief [`agents/refactor-designer.md`](../agents/refactor-designer.md) via the Task tool with: the
refactor target, the slug and paths, and a reminder to name the destination shape, map the seams
and risks (`file:line`), confirm or raise test-coverage gaps, and compile the brief.

### 4. Repo-awareness (respect as context)

Same as [`/design`](./design.md) §5: read the repo's own instruction files once, distil into the
brief's **"Repo conventions in force"** section, never auto-invoke the repo's own agents.

### 5. Verification protocol (the batch round-trip)

Surface the destination shape and migration approach to the user before handing off — the shared
batch round-trip ([`commands/plan.md`](./plan.md) §5): the research pass returns a
`DECISIONS-NEEDED` block, this command presents it, and re-invokes the agent with a
`VERIFIED-DECISIONS` block appended before it records `decisions.md` and compiles the brief.

### 6. The brief is the deliverable

Same bar as `/design`'s: dense, bounded per [`templates/BRIEF.md.tmpl`](../templates/BRIEF.md.tmpl),
reference-not-inline, with a concrete "What execution does NOT need to re-research" section. For a
high-stakes refactor, review
it at `cost: high` via [`/review`](./review.md) `design <slug>` (fresh context, bounded) first.

### 7. Summarise back

- One-paragraph framing of the destination shape.
- The seam/risk map (`file:line`) and any test-coverage gaps confirmed or raised.
- A pointer to `.somi/plans/<slug>/brief.md`.
- Next step: "Review `brief.md`, then run `/plan <slug>` (`cost: medium`)."

## Guardrails

- **Do not edit code.** This command designs scope only; execution runs via `/plan-loop` → `/code-loop`.
- **No behavior changes designed in.** If the destination requires one, that's a feature, not a refactor — stop and say so.
- **Do not skip verification** for the destination shape and the migration approach.
- **No artifact outside `.somi/plans/<slug>/`.**

## Quality bar

See [`agents/refactor-designer.md`](../agents/refactor-designer.md). The brief alone must let a
planner sequence the work and a coder execute it without re-deriving the seam/risk map.
