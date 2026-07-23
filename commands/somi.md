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

Classify per [`skills/somi-routing/SKILL.md`](../skills/somi-routing/SKILL.md) — the canonical
problem-shape → command table, existing-work-item check, and ambiguity guidance (also loaded by
the `somi` agent's classify step on GitHub Copilot). Don't re-derive or re-embed it here.

## Guardrails

- **Read-only.** This command writes nothing — no artifacts, no status changes, no scaffolding.
- **Recommend, don't run.** Mode 2 ends with a recommendation, not a Task.
- **Don't editorialize status.** The table reports what `progress.md` says, not what you infer
  the "real" state to be; discrepancies you notice go in a one-line note, and fixing them is the
  user's call.
