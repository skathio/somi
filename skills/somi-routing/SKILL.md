---
name: somi-routing
description: Use when classifying a free-form request's problem shape into the right SoMi command. The canonical problem-shape → command table used by the somi agent's classify step (Copilot's front door) — edit only here.
---

# SoMi routing — problem shape → command

This is the single source of truth for SoMi's request-classification table. The `somi` agent
(Copilot's front-door persona) loads it instead of embedding its own copy — editing it once here
is what keeps routing decisions in sync across every place a classification is made.

## The table

| Shape (what the request smells like) | Route to |
|---|---|
| A bug — something worked, now doesn't; error/trace/CI failure; cause unknown | [`/debug`](../../commands/debug.md) |
| A bug with the cause already isolated and a fix that [meets the trivial threshold](#the-trivial-threshold) | [`/code`](../../commands/code.md) (no work item needed) |
| Any other small, self-contained change that [meets the trivial threshold](#the-trivial-threshold) | [`/code`](../../commands/code.md) (no work item needed) |
| A whole new product / greenfield idea, requirements open | [`/discover`](../../commands/discover.md) |
| A feature on this repo whose architecture is unsettled (crosses modules, auth/PII, migration, new contract) | [`/design`](../../commands/design.md), then `/plan` |
| A feature whose design is settled — "just sequence and build it" | [`/plan`](../../commands/plan.md) → [`/code-loop`](../../commands/code-loop.md) |
| "Clean this up first" — a small, named smell that fits one safe diff | [`/refactor`](../../commands/refactor.md) |
| "Clean this up first" — spans many modules, needs a migration, or changes a shared shape | [`/refactor-design`](../../commands/refactor-design.md), then `/plan-loop` → `/code-loop` |
| "Is this OK?" — judge existing code / a plan / a design / a PR | [`/review`](../../commands/review.md) (or [`/review-panel`](../../commands/review-panel.md) for high-stakes multi-concern) |
| Security-only / architecture-only / test-shape question | [`/security-review`](../../commands/security-review.md) / [`/architecture-review`](../../commands/architecture-review.md) / [`/test-strategy`](../../commands/test-strategy.md) |
| "Do the whole thing end to end" | [`/ship`](../../commands/ship.md) (gated) or [`/ship-loop`](../../commands/ship-loop.md) (continuous, one gate) |
| Matches an **existing** work item in `.somi/` | continue it — name the slug and its next action instead of starting a parallel item |

## The trivial threshold

"Trivial enough to just code" is defined here and nowhere else. `/code` and the `coder` point at
this section instead of restating it. A request is trivial only if **every** signal holds:

1. **Small footprint** — one file, or one small contiguous change a reviewer reads in a minute.
2. **No new surface** — no new public interface, API/contract, schema or migration, or dependency.
3. **Not security-sensitive** — touches no auth, crypto, secrets, PII, or untrusted-input boundary.
4. **Cause and fix already known** — the change is stated or obvious from the request plus a glance
   at the code; nothing needs investigating first.
5. **Cheap to reverse** — no design decision that would be costly to undo later.

**Any** failed signal means not trivial. **When unsure, it is not trivial.** A request that matches
an existing work item in `.somi/` is never "trivial" — continue that item instead.

- Trivial: "the `--verbose` flag in `cli.mjs` is documented as `-v` but parsed as `-V`; fix the
  parser." One file, known cause, no new surface.
- Not trivial: "add rate limiting to the webhook endpoint." New behaviour across modules, a
  security-sensitive surface, and design choices to settle first, so `/plan` (or `/design`).

Not trivial and cause unknown goes to `/debug`; not trivial and cause known goes to `/plan`.

## Existing-work-item check (do this first)

Check the existing-work-item row **first** — grep `.somi/plans/*/progress.md` and
`.somi/rd/*/README.md` for overlap with the request — before starting a new work item. The
most common routing mistake is scaffolding a duplicate work item for something already in flight.

## Ambiguity disambiguation

If the shape is genuinely ambiguous between two commands, say so and ask the one question that
disambiguates (e.g. "is the architecture for this settled?" splits `/plan` from `/design`).

## Consumers

Loaded for the table by exactly one surface: `agents/somi.md` (the classify step, reached only
after its own invocation-mode gate). Adding a new command's routing row means editing this file
only — the consumer should not re-embed the table. The trivial threshold is also read by
`commands/code.md`, which applies it when no work item resolves.
