---
name: clean-code
description: Use when naming things, structuring functions, deciding whether to add a comment, or cleaning up code mid-implementation. Pragmatic clean-code rules with explicit anti-patterns and when-not-to-apply guidance.
---

# Clean code — pragmatic rules

The principles are in [`rules/20-clean-code.md`](../../rules/20-clean-code.md) — that's the
always-on floor. This skill adds **operational depth**: decision tables (parameter counts,
function length), before/after example pairs (early returns, boolean naming), and
when-not-to-apply guidance. When a section restates the rule verbatim, replace with a pointer
and only keep the operational expansion.

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

Canonical rules: [`rules/20-clean-code.md`](../../rules/20-clean-code.md) §Errors. Operational
expansion specific to this skill:

- **Preserve cause idiomatically.** `raise ProcessingError("step 3") from e` (Python),
  `fmt.Errorf("step 3: %w", err)` (Go), `throw new ProcessingError("step 3", { cause: e })`
  (JS). Don't `throw new Error(e.message)` — the stack and chain are lost.
- **Boundary-decided error logging.** Don't log-and-rethrow at every layer; one log at the
  layer that decides the response. Many duplicates for one event is dashboard noise.

## Structure

Canonical rules: [`rules/20-clean-code.md`](../../rules/20-clean-code.md) §Structure. Operational
addition specific to this skill:

- **No `utils.py` / `helpers.ts` / `common.go`** grab-bag modules. They become SRP graveyards.
  When you reach for one, the actual concept already wants a name — give it one.

## Diff hygiene

See [`rules/20-clean-code.md`](../../rules/20-clean-code.md) §Diff hygiene for the canonical
list. Operational note: hooks (`hooks/pre-tool/guard-protected-paths.sh`) enforce some of these
mechanically (e.g., no lockfile hand-edits, no writes inside `.git/`). When a hook fires, the
rule is being enforced — don't work around the hook.

## When clean-code rules are *not* the right move

- **Hot paths.** Sometimes the readable version costs 10x and you need the gnarly one. Document why.
- **Generated code.** Don't fight your generator's conventions.
- **Existing code without coverage.** Don't "clean up" code you can't safely modify. Refactor under green
  or escalate to [`test-strategist`](../test-strategy/SKILL.md) first.

## The reader test

Write code as if explaining the problem to a smart colleague who knows the language but not this codebase.
Names, structure, and tests should let them follow along without questions. When a reviewer asks "what
does this do?", the code lost.
