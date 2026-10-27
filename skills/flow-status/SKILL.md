---
name: flow-status
description: The SoMi status dashboard procedure, run by the somi-flow runner when the somi dispatcher is invoked with no request.
user-invocable: false
---

# status — the SoMi dashboard

> **Scripts.** Every `node scripts/...` below runs from SoMi's install root, `${CLAUDE_PLUGIN_ROOT}`
> (Claude Code fills in the real path when it loads this skill). Where that still reads as a variable, use
> the root you already know; never search the disk for it.

Read-only: assemble the state of the world **from the artifacts only** — read, never write, start
no agent.

1. **Work items** — every `.somi/plans/<slug>/progress.md`: status, active iteration ("Currently in
   flight"), decisions outstanding (count), last activity date.
2. **Discoveries** — every `.somi/rd/<slug>/README.md`: status (`researching` /
   `awaiting-verification` / `ready-for-planning`).
3. **Open findings** — every `.somi/reviews/<slug>/findings.json`:
   `node scripts/somi-findings.mjs open --slug <slug>` (count + worst severity), or count the
   entries with `"status": "open"` yourself where the script's path isn't known.
4. **Interrupted loops** — any `.somi/somi-state/loop/*.json` with `"status": "running"`: a session
   died mid-loop; `/code-loop` / `/plan-loop` on that slug will **resume** it.

Render a compact table — `Work item | Status | In flight | Open findings | Decisions pending | Last
activity | Next action` — where **Next action** is the point, derived mechanically per row:

- `planning` → finish `/plan <slug>` (or `/plan-loop <slug>`)
- `awaiting-approval` → *you*: read `spec.md`, then approve → `/code-loop <slug>`
- decisions outstanding > 0 → *you*: answer the open decisions (list where)
- interrupted loop present → `/code-loop <slug> …` (resumes from the recorded pass)
- open Blocker/Major findings → `/code <slug>` to address them, then `/review <slug>`
- `in-progress`, nothing blocked → `/code-loop <slug>` on the next not-started iteration
- rd `ready-for-planning` → `/plan <slug>`
- `done` → nothing (omit unless it's the only item; summarise as "N done")
- last activity > 30 days and not done → flag **stale**; ask whether to resume, pause, or abandon

After the table: one line per stale item and per interrupted loop. If `.somi/` doesn't exist, give a
two-line orientation instead of an empty table: what SoMi is, and that describing the problem (or
`/plan`, `/design`, `/discover`, `/debug`) is the way in.

Return the table as the `summary` of a `DONE` block.
