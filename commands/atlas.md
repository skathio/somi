---
description: Build or refresh the Repo Atlas (.somi/atlas.md) — one `cost: high` deep read of the codebase (module map, dependency rules, conventions digest, hotspots, test topology), SHA-stamped and amortized across every later /design, cold /plan, /refactor-design, and /impact.
argument-hint: [nothing — build or refresh] | refresh
allowed-tools: Task, Read, Bash
model: opus
cost: high
---

# /atlas — Build or refresh the Repo Atlas (`cost: high`)

You are running the **repo cartography** workflow of somi: one deep read of this codebase, so
every later design action starts from a map plus the drift since its SHA instead of re-reading
the whole repo per work item.

## What to do

1. **Resolve the mode.** `$ARGUMENTS` empty → build or refresh, whichever applies; `refresh` →
   explicitly request a refresh — the agent's own staleness check still decides whether that's an
   in-place update on small drift or a rebuild of just the affected sections on structural drift,
   never the whole atlas.
2. **Brief the `atlas` agent** ([`agents/atlas.md`](../agents/atlas.md)) with the mode. It runs the
   staleness check itself, does the deep read, and writes `.somi/atlas.md` (and `.somi/README.md`
   if missing) directly — this command owns no writes here.
3. **Relay its summary**: repo framing + module count, top hotspots, thinnest test ice, any
   instruction-vs-practice disagreements, and the next-step line.

## Guardrails

- **No editing the repo beyond the atlas.** If the agent proposes anything else, that's a finding
  for the user, not an action to take here.
- **Commit it.** Recommend committing `.somi/atlas.md` like the other `.somi/` artifacts.
