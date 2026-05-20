---
name: clean-code
description: Use when naming things, structuring functions, deciding whether to add a comment, or cleaning up code mid-implementation. Pragmatic clean-code rules with explicit anti-patterns and when-not-to-apply guidance.
---

# Clean code — pragmatic rules

The full ruleset is in [`rules/20-clean-code.md`](../../rules/20-clean-code.md). This skill expands with
examples and decision rules for the cases that come up most often.

## Naming

### Rules of thumb

- **Intent > mechanics.** `eligibleUserIds` beats `arr`.
- **Length scales with scope.** Loop variable: 1–3 chars. Module-level: spell it out.
- **One concept, one word.** Don't shuffle `fetch`/`get`/`retrieve`/`load`/`pull` for the same operation.
- **No type-encoded prefixes** (`strName`, `bIsValid`).
- **Watch for weasel words**: `Manager`, `Helper`, `Util`, `Processor`, `Handler`, `Service`. They usually
  hide an SRP violation.

### Boolean naming

- **Be a question.** `isActive`, `hasPermission`, `canEdit`, `shouldRetry`.
- **Avoid double negatives.** `isNotInvalid` is unreadable.
- **Avoid ambiguity.** `flag` is meaningless. `accountFrozen` is clear.

### Side-effect signaling

- **Verbs for action**, **nouns for state**.
- `user.name` is state; `user.deactivate()` is action.
- `validateOrder` better not also charge the card. Name truthfully.

## Functions

### Length

Aim for under ~20 lines. Length is a smell, not a hard limit. A 40-line function that reads top-to-bottom
without nesting is fine. A 15-line function with five nested ifs is not.

### Parameters

| Count | Verdict                                                |
|-------|--------------------------------------------------------|
| 0     | Suspect — what state is it pulling from?              |
| 1     | Great.                                                 |
| 2     | Great.                                                 |
| 3     | Borderline. Consider a parameter object if related.    |
| 4+    | Almost always wants a struct/record/object.            |

### Flag arguments

Banned.

```ts
// bad
processOrder(order, true);  // what does `true` mean?

// good
processOrderAndCharge(order);
processOrderAsDraft(order);
```

### Early returns

```python
# bad — pyramid of doom
def process(req):
    if req.is_valid():
        if req.user.has_quota():
            if not req.is_duplicate():
                # actual work, four levels deep
                ...

# good — guard clauses, work at the surface level
def process(req):
    if not req.is_valid(): return Err("invalid")
    if not req.user.has_quota(): return Err("quota")
    if req.is_duplicate(): return Err("duplicate")
    # actual work
    ...
```

## Comments

**Default: no comment.** The bar to add one is high. A comment is justified only when **the WHY is
non-obvious**:

- A hidden constraint (`// must run before the lock is acquired — see issue #2412`).
- A non-local invariant (`// keep aligned with the schema in migrations/0042`).
- A workaround for a specific bug or library quirk (`// libfoo 1.4 returns null for empty results`).
- A subtle performance choice (`// pre-allocate; the hot path runs ~1e6 times/sec`).

**Banned**:

- Narrating WHAT the code does (`// increment i`).
- References to the current PR/task/ticket (`// added for TICKET-1234`) — that rots; PR history is the
  right place.
- Commented-out code (delete it; source control remembers).
- Outdated comments. If you change the code, update or delete the comment.

## Errors

- **Fail loud at boundaries**, trust inside.
- **Don't catch what you can't handle.** Bare `except` / empty catch = bug factory.
- **Preserve cause.** Wrap, don't replace: `raise ProcessingError("step 3") from e`.
- **Don't make errors quiet.** A swallowed error eventually becomes a 3am page.
- **Exceptions for the exceptional.** Validation failure / not-found / conflict often belong in the
  return type, not in exceptions.

## Structure

- **Layering goes one direction.** Domain doesn't know about HTTP. UI doesn't know about SQL.
- **Cohesion over file count.** Things that change together belong together.
- **No `utils.py` / `helpers.ts` / `common.go`** — grow-bag modules are SRP graveyards. Name the actual
  concept.
- **Dead code is debt.** Delete it.

## Diff hygiene

- **One concern per commit/PR.** Bug fix, refactor, formatting — separate.
- **No drive-by reformats** of code you didn't otherwise touch.
- **No `console.log` / `print` / `dbg!`** in the final diff (unless it's the actual fix).
- **No "WIP" leftovers** — `TODO` without owner+condition, commented-out code, scratch files.

## When clean-code rules are *not* the right move

- **Hot paths.** Sometimes the readable version costs 10x and you need the gnarly one. Document why.
- **Generated code.** Don't fight your generator's conventions.
- **Existing code without coverage.** Don't "clean up" code you can't safely modify. Refactor under green
  or escalate to [`test-strategist`](../test-strategy/SKILL.md) first.

## The reader test

Write code as if explaining the problem to a smart colleague who knows the language but not this codebase.
Names, structure, and tests should let them follow along without questions. When a reviewer asks "what
does this do?", the code lost.
