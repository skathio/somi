---
name: flow-atlas
description: The /atlas procedure, loaded by the /atlas command and by the somi-flow runner.
user-invocable: false
---

# /atlas — Build or refresh the Repo Atlas

You are running the **repo cartography** workflow of somi: one deep read of this codebase, so
every later design action starts from a map plus the drift since its SHA instead of re-reading
the whole repo per work item. This command has no `cost:` of its own — and no `model:` of its own
either, so it runs on whatever model this session is already using — and Tasks the
[`somi-atlas`](../../agents/somi-atlas.md) agent for its entire job, which defaults to `high` with no lower
member.

## What to do

1. **Resolve the mode.** `$ARGUMENTS` empty → build or refresh, whichever applies; `refresh` →
   explicitly request a refresh — the agent's own staleness check still decides whether that's an
   in-place update on small drift or a rebuild of just the affected sections on structural drift,
   never the whole atlas.
2. **Brief the `somi-atlas` agent** ([`agents/somi-atlas.md`](../../agents/somi-atlas.md)) — before this `Task`, call
   `somi_resolve` for `somi-atlas` (with `project_dir`), pass its `model`, start it as its `agent_type`, and put the cost line in the briefing (`dispatched at cost: <tier>` only when `enforced` is true, else `requested cost: <tier> (not enforced: no mapped model)`); full rules: the `somi-dispatch` skill (`somi_skill`, or
   `somi:somi-dispatch` on Claude Code) — with the mode. It runs the
   staleness check itself, does the deep read, and writes `.somi/atlas.md` (and `.somi/README.md`
   if missing) directly — this command owns no writes here.
3. **Relay its summary**: repo framing + module count, top hotspots, thinnest test ice, any
   instruction-vs-practice disagreements, and the next-step line.

## Guardrails

- **No editing the repo beyond the atlas.** If the agent proposes anything else, that's a finding
  for the user, not an action to take here.
- **Commit it.** Recommend committing `.somi/atlas.md` like the other `.somi/` artifacts.
