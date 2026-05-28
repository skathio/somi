---
description: Surgical, behavior-preserving refactor of a named smell. Tests stay green; no feature work mixed in. Use when the next change requires untangling first.
argument-hint: <smell description and target files>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

# /refactor — Surgical refactor

You are invoking the **refactorer** workflow of somi-ai.

The user's refactor target: **$ARGUMENTS**

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
- **No big-bang rewrites.** If the destination requires a 600-line diff, the refactor should probably be
  a plan, not a single command.
- **Tests stay green** at every step. Not "green at the end" — green at every commit.

## Quality bar

See [`agents/refactorer.md`](../agents/refactorer.md). A successful refactor leaves the next planned
change *easier*, not just different.
