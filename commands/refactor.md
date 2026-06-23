---
description: Refactor a named smell. Surgical (default) — behavior-preserving, tests stay green, no feature work. Or MAX analysis for a large refactor — designs the scope and compiles a brief.md, then /plan-loop → /code-loop execute it. Use when the next change requires untangling first.
argument-hint: <smell description and target files>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

# /refactor — Refactor (surgical, or MAX analysis for large ones)

You are invoking the **refactorer** workflow of somi.

The user's refactor target: **$ARGUMENTS**

## Pick the mode first

- **Surgical (default).** A small, named smell that fits one safe behavior-preserving diff — the
  refactorer does it directly (steps 1–6 below).
- **Analysis (MAX, large refactor).** When the refactor spans many modules, needs a migration, or
  changes a shared shape — too big for one safe diff (a 600-line refactor is a *plan*, not a diff) —
  the refactorer instead runs the MAX **analysis mode**: it identifies and designs the refactor
  scope and compiles a [`brief.md`](../templates/BRIEF.md.tmpl) under `.somi/plans/<slug>/`, then the
  ECO tier executes it via [`/plan-loop`](./plan-loop.md) → [`/code-loop`](./code-loop.md). Choose
  this when the destination needs more than a single reviewable diff; surface the scope to the user
  before handing off. For a high-stakes refactor, review the brief in MAX scope first via
  [`/review`](./review.md) `design <slug>` (fresh context, bounded).

The steps below are the **surgical** path.

## What to do (surgical path)

1. **Verify the precondition**: the refactor target is a *named smell* (e.g., "`OrderService` mixes pricing
   and persistence") with specific files in scope. If `$ARGUMENTS` is vague ("clean up the codebase"),
   stop and ask the user to name the smell and files.
2. **Verify test coverage exists** for the behavior to be preserved. If it doesn't, the first step is to
   add characterization tests — surface this to the user and ask whether to proceed or hand off to
   `test-strategist` first.
3. **Brief the `refactorer` agent** ([`agents/refactorer.md`](../agents/refactorer.md)) with the smell,
   the target files, and the destination shape.
4. **The agent performs small, named refactor steps** with tests green between each.
5. **Verify** by running the tests yourself.
6. **Summarize back** with:
   - The smell that was addressed.
   - The destination shape achieved.
   - The sequence of refactor steps (one line each).
   - Test results.
   - Follow-ups (bugs noticed but not fixed, further refactors deferred).

## Guardrails

- **No behavior changes.** No bug fixes mixed in. If a bug is discovered, file it as follow-up.
- **No feature work.** This is structure-only.
- **No big-bang rewrites on the surgical path.** If the destination requires a 600-line diff, switch
  to **analysis mode** above: the refactorer designs the scope and compiles a `brief.md`, then
  `/plan-loop` → `/code-loop` execute it as bounded, reviewable iterations.
- **Tests stay green** at every step. Not "green at the end" — green at every commit.

## Quality bar

See [`agents/refactorer.md`](../agents/refactorer.md). A successful refactor leaves the next planned
change *easier*, not just different.
