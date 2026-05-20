# 10 — SOLID, operationalized

The point of SOLID is not "five things to recite" — it is "five questions to ask before a design ossifies".
Use these questions during planning, while coding, and during review.

## S — Single Responsibility

> A module should have one reason to change.

**Ask:** Who is the user of this module, and what would make *that user* want it modified?

**Smells:**
- A class whose method names cluster into two unrelated themes (e.g., `parseInput` + `sendEmail`).
- A function with an "and" in a one-sentence description.
- A file whose imports come from two unrelated layers (HTTP + database driver in the same file).

**Fix:** Split along the **axis of change**, not along noun categories. "Authentication" and "User profile"
are two reasons to change, even though both are about users.

## O — Open/Closed

> Open for extension, closed for modification.

**Ask:** When the next requirement lands, can I add behavior **without** editing existing code?

**Smells:**
- A growing `switch`/`if-else` that adds a branch every time a new variant is introduced.
- "Just one more `if`" in a function that already has five.

**Fix:** Polymorphism, strategy pattern, registry pattern, or table-driven dispatch — only when the variation
is real, not speculative. **Do not** introduce a strategy interface for a single concrete case.

**Anti-pattern to avoid:** Open/Closed at the cost of readability. Three `if` branches are fine.

## L — Liskov Substitution

> Subtypes must be usable wherever their base type is expected, without breaking invariants.

**Ask:** Does the subclass strengthen preconditions or weaken postconditions of the parent?

**Smells:**
- A subclass that throws `NotSupportedException` for a parent's method.
- A subclass that requires extra setup callers can't know about.
- "It's-a" relationships that are actually "is-implemented-using".

**Fix:** Prefer composition. If `Square extends Rectangle` makes you want to override `setWidth`, the
relationship is wrong.

## I — Interface Segregation

> Clients should not depend on methods they don't use.

**Ask:** What does each caller actually need? Is the interface they depend on shaped like *their* need
or like the implementer's convenience?

**Smells:**
- A 12-method interface where most callers use 2 methods.
- "God" interfaces (`IService`, `IManager`) with grab-bag method lists.
- Tests that have to mock five methods to exercise one path.

**Fix:** Smaller, role-shaped interfaces. Compose them at the implementation site.

## D — Dependency Inversion

> High-level policy should not depend on low-level mechanism. Both should depend on abstractions.

**Ask:** Does the business rule know about Postgres, S3, or HTTP? It shouldn't.

**Smells:**
- Domain logic imports a database driver.
- Use-cases instantiate adapters directly with `new`.
- Tests can't run without a real network or filesystem.

**Fix:** Inject collaborators. The domain defines the interface (in the domain's language), and the
infrastructure layer implements it. **Do not** invert dependencies that don't need to vary —
abstractions you never swap are just extra indirection.

---

## Meta-rules

- **YAGNI beats SOLID** when the variation is hypothetical. SOLID is a response to *actual* change pressure,
  not a preemptive design tax.
- **Three is the magic number.** Don't abstract until you have three concrete cases. Two cases is a
  coincidence; three is a pattern.
- **Refactoring under green** — when you spot a SOLID violation in code you're touching, raise it.
  If the fix is small and the tests cover it, do it now. If it isn't, log it as follow-up work in the plan.
