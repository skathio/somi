# Rules

The SoMi ruleset is the **always-loaded** layer of the system. Every agent, every workflow, every
slash command operates against these rules. The composed `CLAUDE.md` is the canonical entry point.

## Composition

`rules/CLAUDE.md` references the numbered files in order. They form a layered ruleset:

| File                                                           | Layer                                  |
|----------------------------------------------------------------|----------------------------------------|
| [`rules/00-priorities.md`](../rules/00-priorities.md)          | Conflict resolution, uncertainty, escalation |
| [`rules/10-solid.md`](../rules/10-solid.md)                    | SOLID, operationalized                 |
| [`rules/20-clean-code.md`](../rules/20-clean-code.md)          | Naming, functions, comments, errors    |
| [`rules/30-security-owasp.md`](../rules/30-security-owasp.md)  | OWASP Top 10 defenses                  |
| [`rules/40-engineering-practices.md`](../rules/40-engineering-practices.md) | Testing, observability, delivery |
| [`rules/50-collaboration.md`](../rules/50-collaboration.md)    | Working with humans + agent handoffs   |
| [`.somi/rules/99-overrides.md`](../rules/99-overrides.md) (template shown) | Project escape hatch       |

## The fixed priority stack

When two rules pull in different directions:

```
1. Security
2. Correctness
3. Maintainability
4. Performance & cost (within the envelope)
5. Convenience
```

Higher priorities override lower ones. Lower priorities **cannot** override higher ones without
explicit human sign-off captured in the artifact (PR description, ADR, plan).

## What goes in `99-overrides.md`

Lives at **`.somi/rules/99-overrides.md`** in your project — never under `.claude/` or `.github/`,
so the location is the same regardless of which host (Claude Code, GitHub Copilot) is consuming
SoMi. Project-specific overrides and conventions. **SoMi never touches this file.** Use it when:

- You need to override a SoMi default (with a documented reason and removal condition).
- You have project-specific conventions on top of the global rules.
- You want a pinned list of "things that look wrong but are intentional in this codebase."

Each override has a shape (see the file itself for the template): rule overridden, what changes, why,
removal condition.

## Why a single, composed `CLAUDE.md`

Claude Code loads the project's `CLAUDE.md` automatically. By placing the composed ruleset there
(installer writes `CLAUDE.md` at the project root pointing at the numbered files), every Claude
session in the project starts with the same priors, in the same order.

Project-specific additions sit above or below the SoMi-managed section in `CLAUDE.md`. SoMi marks its
section so future installs/updates can refresh it without clobbering project additions.

## Why not put everything in `CLAUDE.md` directly?

Two reasons:

1. **Maintenance.** A 2000-line `CLAUDE.md` is unreviewable. Numbered files keep each concern small
   enough to reason about.
2. **Composability.** Skills, agents, and reviewers reference `rules/30-security-owasp.md` directly.
   Keeping the rules as separate files makes them addressable.

## Conflict resolution between layers

When a SoMi rule and a project rule conflict:

1. Project rules win (specifically: `99-overrides.md` and the project's own `CLAUDE.md`).
2. Within SoMi, lower-numbered files compose into higher-numbered ones — but the **priority stack**
   in `00-priorities.md` is the final tie-breaker.
3. If conflict remains: surface it to the human in the artifact (don't make a silent call).

## Updating rules

If a SoMi rule is wrong, file an issue / PR against SoMi. Local hot-fixes go in `99-overrides.md`
with a removal condition pointing at the upstream fix.

When SoMi updates a numbered file, `/plugin update somi` pulls the new version. Your
`99-overrides.md` remains untouched.

## What rules are *not*

- **Not language- or framework-specific.** Those go in skills or in your project's `CLAUDE.md`.
- **Not exhaustive.** Rules cover the universal floor; skills cover domain depth.
- **Not vague platitudes.** Every rule should be actionable and contestable. "Be a good engineer" is
  not a rule.
- **Not forever.** Rules evolve. When a rule stops being useful, propose removing it.
