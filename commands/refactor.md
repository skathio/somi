---
description: Refactor a named smell. Surgical, behavior-preserving execution against a smell that fits one safe diff — tests stay green, no feature work. For a refactor too big for one diff, use /refactor-design instead.
argument-hint: <smell description and target files>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

# /refactor — Surgical refactor

You are invoking the **refactorer** workflow of somi. This command has no `cost:` of its own —
its `model:` is a separate, host-level selection — and Tasks the [`refactorer`](../agents/refactorer.md) agent, which
declares `cost: low, medium` for this mode (`medium` unless the session ceiling resolves to `low`).

The user's refactor target: **$ARGUMENTS**

## Precondition — this command is surgical only

This command performs a **small, named smell** that fits one safe, behavior-preserving diff. If the
refactor spans many modules, needs a migration, or changes a shared shape — too big for one safe
diff (a 600-line refactor is a *plan*, not a diff) — stop and recommend
[`/refactor-design`](./refactor-design.md) instead: it designs the refactor scope and compiles a
`brief.md` that [`/plan-loop`](./plan-loop.md) → [`/code-loop`](./code-loop.md) then execute. Mode
selection and tier selection are separate decisions, which is why this is its own command rather
than a mode flag; see [`agents/refactorer.md`](../agents/refactorer.md)'s `> **Cost:**` callout.

## What to do

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
- **No big-bang rewrites.** Same threshold as the precondition above — if it's crossed mid-refactor,
  stop and hand off to [`/refactor-design`](./refactor-design.md) instead of pushing through.
- **Tests stay green** at every step. Not "green at the end" — green at every commit.

## Quality bar

See [`agents/refactorer.md`](../agents/refactorer.md). A successful refactor leaves the next planned
change *easier*, not just different.
