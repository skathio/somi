# Rules

The SoMi ruleset is the system's baseline layer — every agent, workflow, and slash command operates
against it. `rules/CLAUDE.md` is the **canonical source**, from which the injected digest is
extracted. On Claude Code it is not itself loaded into a consuming project's context; on GitHub
Copilot, `extension.json`'s `"rules"` key loads it directly. See
[How the ruleset reaches your session](#how-the-ruleset-reaches-your-session) for what actually
arrives, and when.

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

## How the ruleset reaches your session

**SoMi never writes to your project's `CLAUDE.md`, and you do not need to edit anything.**

A Claude Code plugin **cannot** ship an always-on `CLAUDE.md`: `plugin.json` has no `rules` key, and
a plugin-root `CLAUDE.md` is not loaded as project context. So SoMi delivers the ruleset in three
pieces. The hook is registered automatically on plugin install — the same "you do not need to edit
`.claude/settings.json`" guarantee [`docs/INSTALL.md`](./INSTALL.md) makes for hooks generally — but
what it *emits* varies per turn:

| What arrives | Mechanism | On which turns |
|---|---|---|
| **Priority/discipline floor** (a header + 4 bullets) | `UserPromptSubmit` hook, unconditional | **Every turn**, always |
| **The digest** (the bullets between `<!-- digest:start/end -->` in `rules/CLAUDE.md`) | Same hook, signature-gated | Only when the work-item signature **changes** — or when no signature file exists yet |
| **The numbered files `00`–`50`** | The `rules` skill | On demand, when the model enters a rule's domain |

> **If the digest never appears at all**, the hook is failing safe rather than erroring:
> `buildTier2Digest()` returns empty — leaving the floor untouched — when the plugin root cannot be
> resolved, `rules/CLAUDE.md` is unreadable, or its `<!-- digest:start/end -->` markers are missing
> or malformed. No warning is emitted in any of those cases.

> **The digest gate is not session-scoped.** It compares against
> `.somi/somi-state/last-context-signature`, a project-local file that nothing resets — no
> SessionStart hook clears it (SoMi ships one, but it only detects repo instruction files), and
> there is no TTL. The signature hashes `.somi/plans/`, `.somi/reviews/`, and
> `.somi/rd/`. So in a project that **never runs a SoMi workflow**, the digest is emitted on the
> first prompt after install and **not again**; every later turn, in every later session, gets the
> floor only. In a project actively using `/plan`, `/code`, or `/review`, it re-fires whenever those
> artifacts change.

**On GitHub Copilot**, `.copilot-extension/extension.json`'s `"rules"` key already points at
`rules/CLAUDE.md` and needs no change.

Your own project `CLAUDE.md` stays entirely yours — SoMi never writes to it, and never has. Project
overrides go in `.somi/rules/99-overrides.md`, which SoMi never touches.

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
