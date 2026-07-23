---
name: somi-routing
description: Use when classifying a free-form request's problem shape into the right SoMi command. The canonical problem-shape → command table shared by /somi's Mode 2 and the somi agent's classify step — edit only here.
---

# SoMi routing — problem shape → command

This is the single source of truth for SoMi's request-classification table. Both `/somi` (Mode 2)
and the `somi` agent (Copilot's front-door persona) load it instead of embedding their own copy —
editing it once here keeps both consumers in sync, which is the whole reason this skill exists (D3).

## The table

| Shape (what the request smells like) | Recommend |
|---|---|
| A bug — something worked, now doesn't; error/trace/CI failure; cause unknown | [`/debug`](../../commands/debug.md) |
| A bug with the cause already isolated and a trivial fix | [`/code`](../../commands/code.md) (no work item needed if truly one-file) |
| A whole new product / greenfield idea, requirements open | [`/discover`](../../commands/discover.md) |
| A feature on this repo whose architecture is unsettled (crosses modules, auth/PII, migration, new contract) | [`/design`](../../commands/design.md), then `/plan` |
| A feature whose design is settled — "just sequence and build it" | [`/plan`](../../commands/plan.md) → [`/code-loop`](../../commands/code-loop.md) |
| "Clean this up first" / structure blocks the next change | [`/refactor`](../../commands/refactor.md) |
| "Is this OK?" — judge existing code / a plan / a design / a PR | [`/review`](../../commands/review.md) (or [`/review-panel`](../../commands/review-panel.md) for high-stakes multi-concern) |
| Security-only / architecture-only / test-shape question | [`/security-review`](../../commands/security-review.md) / [`/architecture-review`](../../commands/architecture-review.md) / [`/test-strategy`](../../commands/test-strategy.md) |
| "Do the whole thing end to end" | [`/ship`](../../commands/ship.md) (gated) or [`/ship-loop`](../../commands/ship-loop.md) (continuous, one gate) |
| Matches an **existing** work item in `.somi/` | continue it — name the slug and its next action instead of starting a parallel item |

## Existing-work-item check (do this first)

Check the existing-work-item row **first** — grep `.somi/plans/*/progress.md` and
`.somi/rd/*/README.md` for overlap with the request — before recommending a new work item. The
most common routing mistake is scaffolding a duplicate work item for something already in flight.

## Ambiguity disambiguation

If the shape is genuinely ambiguous between two commands, say so and ask the one question that
disambiguates (e.g. "is the architecture for this settled?" splits `/plan` from `/design`).

## Consumers

Loaded by exactly two surfaces: `commands/somi.md` (Mode 2) and `agents/somi.md` (the classify
step, reached only after its own invocation-mode gate). Adding a 10th command's routing row means
editing this file only — neither consumer should re-embed the table.
