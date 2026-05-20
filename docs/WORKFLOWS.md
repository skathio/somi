# Workflows

SOMI organises Claude's behavior into three first-class workflows. Each has a clean handoff to the
next. Each produces a durable artifact. Each can be invoked alone or as part of `/ship`.

## The three workflows

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   PLANNING      │ ───▶ │     CODING      │ ───▶ │   REVIEWING     │
│   /plan         │      │     /code       │      │   /review       │
│   agent:planner │      │   agent:coder   │      │ agent:reviewer  │
│   → PLAN.md     │      │   → diff+tests  │      │   → REVIEW.md   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                                                  │
        │                                                  │
        └──────────────  re-plan if blocker  ──────────────┘
```

## Planning

**Purpose**: produce deep implementation plans before any code is written.

**Agent**: [`planner`](../agents/planner.md).

**Input**: a problem statement from the user.

**Output**: `PLAN.md` with — at minimum — problem framing, goals/non-goals, assumptions, unknowns,
architecture sketch, tradeoffs considered, sequenced phases, PR-sized iteration slices, test strategy,
security considerations, observability plan, rollout & rollback, risk register, definition of done,
and open questions.

**Quality bar**: a different engineer should be able to pick up phase 1, iteration 1 and start coding
**without asking another question**. Phases are not generic mechanics ("implement", "test", "deploy");
they're real, coherent, reviewable increments of work. Risks are concrete failure modes with concrete
mitigations.

**Stops the workflow**: never starts coding. The human must approve.

**Handoff to coding**: explicit. Code references the phase/iteration being executed.

## Coding

**Purpose**: implement against an approved plan with senior-level design judgment.

**Agent**: [`coder`](../agents/coder.md).

**Input**: an iteration from `PLAN.md`, or a self-contained trivial task.

**Output**: a coherent diff + tests + updated docs (when behavior changes) + a summary identifying
what changed, what was not done, and what to look at first.

**Quality bar**: tests pass locally (the agent ran them), naming/structure match surrounding code,
no scope drift, no silent compromises, no leftover debug. Design judgment applied while implementing:
the agent notices bad abstractions, leaky boundaries, and hidden coupling, and either fixes them in
scope or surfaces them as follow-ups.

**Re-plans on scope discovery**: if the planned approach turns out to produce bad code, the coder
**stops and re-plans** rather than silently widening scope.

**Handoff to reviewing**: explicit. The reviewer reads the plan, the diff, and the summary.

## Reviewing

**Purpose**: strict, skeptical, evidence-driven review of code, plans, or architectural proposals.

**Agent**: [`reviewer`](../agents/reviewer.md). Calls in [`security-reviewer`](../agents/security-reviewer.md),
[`architecture-reviewer`](../agents/architecture-reviewer.md), or
[`test-strategist`](../agents/test-strategist.md) when the change matches their territory.

**Input**: a diff (working tree, range, PR), a plan, an ADR, or a file.

**Output**: `REVIEW.md` with severity-graded findings (Blocker / Major / Minor / Nit), each with a
location, what's wrong, why it matters, and a suggested fix.

**Quality bar**: no rubber-stamping. If the diff is clean, the reviewer says so with evidence (read X,
traced Y). Findings cite specific file:line locations. Reject when warranted.

**Handoff back to coding (rework)**:
- **Blocker** — must fix before merge.
- **Major** — should fix; merging without resolution requires explicit human sign-off.
- **Minor** — nice to fix; can be follow-up.
- **Nit** — style/taste, no obligation.

---

## Why these three (and not four, or five)

The split tracks the **three reasons engineering work is hard**:
- **Planning** — knowing what to build and in what order.
- **Coding** — executing without introducing new problems.
- **Reviewing** — catching what the executor missed.

These three exist in every engineering team's day; SOMI makes them explicit and gives each one a
specialised agent with a clear quality bar.

Support agents (`security-reviewer`, `architecture-reviewer`, `test-strategist`, `refactorer`) are
*facets* of these three, invoked when the work clearly engages their domain. They aren't separate
workflows because they don't have separate problem-shapes; they're depth-on-demand.

## When workflows compose

- **Plan → Code → Review** is the normal sequence.
- **Plan → Plan-review → Code → Review** when the plan is high-stakes or high-ambiguity.
- **Code → Review → Code (rework) → Review** when the first review surfaces findings.
- **Plan → Code → Review → Plan (re-plan)** when review reveals the plan was wrong, not just the code.
- **Refactor (standalone)** when the next planned change requires untangling first; refactor is its
  own mini-cycle that returns the codebase to a state where the planned change is easy.

## The `/ship` shortcut

`/ship <problem>` runs the full pipeline with hard gates between stages. It's identical to running
`/plan`, then `/code`, then `/review` manually — just with the orchestration baked in. Use whichever
feels natural; the underlying agents and quality bars are the same.

## What SOMI workflows are *not*

- **Not a substitute for human judgment.** The human approves between stages.
- **Not a one-shot.** Each stage is iterative; review feedback flows back into coding; coding can
  flow back into planning.
- **Not silent.** Every stage produces a durable artifact you can read, edit, and reject.
