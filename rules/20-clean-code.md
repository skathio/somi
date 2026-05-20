# 20 — Clean code

Operational rules for naming, functions, structure, comments, and errors. The goal is **code that reads
like a description of the problem**, not a description of the solution's mechanics.

## Naming

- **Names express intent.** `userIdsToRetry` beats `arr2`. `RegistrationRequest` beats `Data`.
- **No type-encoded prefixes** (`strName`, `arrUsers`). The type system already says it.
- **Avoid weasel words** in names: `Manager`, `Helper`, `Util`, `Processor`. They usually hide an SRP violation.
- **Length scales with scope.** Loop variable in 3 lines? `i` is fine. Module-level variable? Spell it out.
- **Consistent vocabulary.** Pick one word per concept. Don't shuffle `fetch`/`get`/`retrieve`/`load` for
  the same operation across the codebase.

## Functions

- **Do one thing.** If you can describe the function with a sentence containing "and", split it.
- **Short by default.** Aim for ≤ ~20 lines. Length is a smoke alarm, not a hard limit.
- **Few parameters.** 0–2 is great, 3 is borderline, 4+ wants a struct/record/object.
- **No flag arguments.** `process(input, true)` is opaque. Two functions are better than one boolean.
- **No hidden side effects.** A function called `validateOrder` must not also `chargeCard`.
- **Return early.** Guard clauses beat deep nesting.

## Comments

- **Default: no comment.** Well-named code does not need it.
- **Write a comment when the WHY is non-obvious**: a hidden constraint, a non-local invariant, a workaround
  for a specific bug or library quirk, a subtle performance choice.
- **Never narrate WHAT** the code does. `// increment i` is noise.
- **Never reference the current task or PR** (`// added for ticket FOO-123`). It rots; PR history is the
  right place.
- **TODO/FIXME** should have an owner and a condition for removal, not just "fix later".

## Errors

- **Fail loud, fail early** at boundaries. Validate inputs at the edge; trust them inside.
- **Don't catch what you can't handle.** A bare `try { ... } catch (e) {}` is a bug factory.
- **Don't swallow** errors to "make tests pass". The test is telling you something.
- **Preserve context.** Re-raise with the original cause attached. Don't `throw new Error(e.message)` and
  lose the stack.
- **Exceptions are for exceptional cases.** Expected failure modes (validation, not-found, conflict) often
  belong in the return type, not in exceptions.

## Structure

- **Cohesion over file count.** Two things that change together belong together.
- **Layering goes one direction.** Domain doesn't import infrastructure. UI doesn't import data access.
- **Dead code is debt.** Delete it. Source control remembers.
- **Don't speculate.** No `class FutureExtensionPoint` until the second concrete case appears.

## Diff hygiene

- **One concern per diff.** Bug fixes, refactors, and reformats are separate commits/PRs.
- **No drive-by reformats** of code you didn't otherwise touch. Reformatting hides logic changes.
- **No commented-out code** in the final diff. Either it's used or it's gone.
- **No `console.log`, `print`, or debug shims** in the final diff unless they're the actual fix.

## Mental model

Write code the way you'd explain the problem to a smart colleague who knows the language but not this
codebase. Names, structure, and tests should let them follow along without asking questions. When a
reviewer has to ask "what does this do?" the code lost.
