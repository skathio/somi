---
description: SoMi's front door. No args — a status dashboard of every work item, discovery, interrupted loop, and open finding, each with its next action. With args — classifies your request's problem shape and recommends the right entry command (never auto-invokes it).
argument-hint: [nothing — status] | <describe what you want to do — router>
allowed-tools: Read, Grep, Glob, Bash
model: sonnet
---

# /somi — Status dashboard & workflow router

You are running SoMi's **front door**. Two modes, by argument:

The user's input (may be empty):

```user-request
$ARGUMENTS
```

## Mode 1 — Status dashboard (no arguments)

Assemble the state of the world **from the artifacts only** — read, never write:

1. **Work items** — for every `.somi/plans/<slug>/progress.md`: status, active iteration (from
   "Currently in flight"), decisions outstanding (count), last activity date.
2. **Discoveries** — for every `.somi/rd/<slug>/README.md`: status (`researching` /
   `awaiting-verification` / `ready-for-planning`).
3. **Open findings** — for every `.somi/reviews/<slug>/findings.json`:
   `node scripts/somi-findings.mjs open --slug <slug>` (count + worst severity).
4. **Interrupted loops** — any `.somi/somi-state/loop/*.json` with `"status": "running"`: a
   session died mid-loop; `/code-loop` / `/plan-loop` on that slug will **resume** it.

Render a compact table:

| Work item | Status | In flight | Open findings | Decisions pending | Last activity | Next action |
|---|---|---|---|---|---|---|

**The "Next action" column is the point** — derive it mechanically, one per row:

- status `planning` → finish `/plan <slug>` (or `/plan-loop <slug>`)
- status `awaiting-approval` → *you*: read `spec.md`, then approve → `/code-loop <slug>`
- decisions outstanding > 0 → *you*: answer the open decisions (list where)
- interrupted loop present → `/code-loop <slug> …` (it resumes from the recorded pass)
- open Blocker/Major findings → `/code <slug>` to address `F-<n>`, then `/review <slug>`
- status `in-progress`, nothing blocked → `/code-loop <slug>` next not-started iteration
- rd `ready-for-planning` → `/plan <slug>`
- status `done` → nothing (omit from the table unless it's the only item; summarise as "N done")
- last activity > 30 days and not done → flag as **stale** — ask the user whether to resume,
  pause, or abandon (status change is theirs to make)

After the table: one line per stale item and per interrupted loop, and — if `.somi/` doesn't
exist at all — a two-line orientation instead of an empty table: what SoMi is, and that
`/plan <problem>` (or `/design`, `/discover`, `/debug` per the router below) is the way in.

## Mode 2 — Router (arguments present)

Classify the request's **problem shape** and recommend the entry command — with a one-line *why*
— then stop. **Never invoke the recommended command yourself**; the user runs it (or asks you
to). Recommending is cheap; a wrong auto-invocation scaffolds artifacts the user has to clean up.

| Shape (what the request smells like) | Recommend |
|---|---|
| A bug — something worked, now doesn't; error/trace/CI failure; cause unknown | [`/debug`](./debug.md) |
| A bug with the cause already isolated and a trivial fix | [`/code`](./code.md) (no work item needed if truly one-file) |
| A whole new product / greenfield idea, requirements open | [`/discover`](./discover.md) |
| A feature on this repo whose architecture is unsettled (crosses modules, auth/PII, migration, new contract) | [`/design`](./design.md), then `/plan` |
| A feature whose design is settled — "just sequence and build it" | [`/plan`](./plan.md) → [`/code-loop`](./code-loop.md) |
| "Clean this up first" / structure blocks the next change | [`/refactor`](./refactor.md) |
| "Is this OK?" — judge existing code / a plan / a design / a PR | [`/review`](./review.md) (or [`/review-panel`](./review-panel.md) for high-stakes multi-concern) |
| Security-only / architecture-only / test-shape question | [`/security-review`](./security-review.md) / [`/architecture-review`](./architecture-review.md) / [`/test-strategy`](./test-strategy.md) |
| "Do the whole thing end to end" | [`/ship`](./ship.md) (gated) or [`/ship-loop`](./ship-loop.md) (continuous, one gate) |
| Matches an **existing** work item in `.somi/` | continue it — name the slug and its next action (per Mode 1's rules) — instead of starting a parallel item |

Check the existing-work-item row **first** (grep `.somi/plans/*/progress.md` and
`.somi/rd/*/README.md` for overlap with the request) — the most common routing mistake is
scaffolding a duplicate work item for something already in flight.

If the shape is genuinely ambiguous between two commands, say so and ask the one question that
disambiguates (e.g. "is the architecture for this settled?" splits `/plan` from `/design`).

## Guardrails

- **Read-only.** This command writes nothing — no artifacts, no status changes, no scaffolding.
- **Recommend, don't run.** Mode 2 ends with a recommendation, not a Task.
- **Don't editorialize status.** The table reports what `progress.md` says, not what you infer
  the "real" state to be; discrepancies you notice go in a one-line note, and fixing them is the
  user's call.
