---
name: somi-dispatch
description: The one canonical procedure for resolving and starting any SoMi agent — call `somi_resolve`, honour the fallback order, map the result onto a `Task` call carrying the resolved tier and model, and announce a `low` session ceiling once per session. Loaded by the front door and by every command that Tasks an agent directly — edit only here.
---

# somi-dispatch — resolve, then start, one agent

This is the single canonical procedure for turning "start agent X" into a real `Task` call —
resolving its cost tier and model against the session ceiling first, every time, on every entry
path. The `somi` front-door agent and every command that Tasks an agent directly load this skill
instead of carrying their own copy of it — editing it once here keeps every entry path in sync,
which is the whole reason this skill exists (the same precedent `skills/somi-routing` sets).

## When this applies

Whenever your own procedure is about to start an agent via `Task` — whether that's the only agent
a simple command Tasks, one of several a multi-agent command seats in turn, or an agent the front
door reaches while running a command's procedure live. It does **not** apply to a `Task` line that
names another *command* (`Task /code-loop`, `Task /review-panel`, …) — a command is not an agent
and there is nothing here to resolve for it; enter that command's own procedure instead and let its
own agent-Tasks reach this skill in turn.

**A re-invocation resolves fresh too, every time, the same as a first start.** The planner,
designer, discovery-analyst, and refactor-designer are all re-invoked in authoring mode after a
`DECISIONS-NEEDED` round-trip pauses for the user (`commands/plan.md`, `commands/design.md`,
`commands/discover.md`, `commands/refactor-design.md`) — that pause is exactly when a user is
likely to raise the ceiling, so treating the re-invocation as "already resolved" from before the
pause would silently miss it. There is no shape of "starting an agent" that skips this procedure.

## 1. Resolve the agent's dispatch tier

Call the bundled `somi_resolve` tool — never by reading the agent's frontmatter and judging it
yourself; that is the last-resort fallback below, reached only when nothing else can be called at
all. A host may surface the tool namespaced by plugin and server (e.g. `mcp__somi__somi_resolve`);
call it by its bare name, `somi_resolve`, regardless of how it's namespaced.

```
somi_resolve({ agent: "<agent name>", host: "<host>",
               project_dir: "<absolute path of the project you are working in this session>" })
```

**Always pass `project_dir`.** The server is launched once, from SoMi's own install location, not
the project you're working in, and it never guesses which project that is — without a root of its
own it refuses outright (exit `67`, see Failures below). Give it the absolute path of the project
this session is actually working in — read your own working directory to get it (a shell `pwd` if
you have one this turn, or the workspace root the host already told you at session start) — never a
relative path, and never SoMi's own install directory.

**Pass `ceiling` only when the user actually asked, in this turn, to change the session ceiling.**
It is not a per-call filter — passing it **persists** the value: it is saved to
`.somi/somi-state/ceiling.json` and stays in force for every later resolve, this session and every
later one, until something moves it again. Omit it on every ordinary resolve.

Name `<host>` precisely, never guess it: `claude-code` if this turn is running in Claude Code,
`copilot` if it's running in GitHub Copilot.

### Fallback order — try in this order, every time

1. **The `somi_resolve` tool** (above) — the primary path, tried first, on either host.
2. **The CLI, by path** — `node scripts/somi-dispatch.mjs resolve --agent <agent name> --host <host> [--ceiling <tier>]` —
   only where SoMi's own files are actually reachable at a path you already know without guessing
   (e.g. this session is working inside the SoMi repo itself, or a vendored install whose
   `${SOMI_VENDOR_ROOT}` you already have). This is not a general substitute for the tool: most
   consuming projects give a prompt no way to know where SoMi is installed at all, which is the
   entire reason the tool exists.
3. **The disclosed last-resort judgment fallback** (§4 below) — reached only when *neither* of the
   above can even be attempted: no MCP tool call is possible in this turn, **and** no shell is
   available to run the CLI (or SoMi's install path genuinely isn't known).

**A tool call that reaches the server and returns an error is never a reason to fall back.** Map
its exit code (§3) and stop — falling back to the CLI or to judgment after a real error would bury
the actual failure under a second, unrelated guess. The fallback order above is for when a resolver
genuinely cannot be reached at all, never for a reachable one that answered with a failure.

## 2. Read the result

The tool's JSON comes back in its text content; the CLI fallback prints the identical shape to
stdout:

```json
{"agent": "coder", "supported": ["low", "medium"], "tier": "medium", "model": "<mapped model>", "ceiling": "high", "ceiling_source": "default", "ceiling_origin": "default"}
```

- `tier` — the cost tier the resolver selected for this agent, right now.
- `model` — pass this to `Task` when it is non-null. When it is `null` (no mapping for this
  host/tier), see "No mapped model" below — never omit a model silently *and* never invent one
  without saying so.
- `ceiling` / `ceiling_source` / `ceiling_origin` — see the announcement rule immediately below.

**Announce a `low` ceiling once per session, before the first agent it applies to starts** — not
once per command, and not again for every later agent this session that also resolves `low`.
"Once per session" means **once in this conversation's visible context** — a repeat is fine, not a
violation, after a context compaction (the earlier announcement is no longer visible to check
against) or inside a Tasked command's own fresh context (a subagent has no visibility into what the
orchestrator already announced). The first time a resolve call in the *currently visible* context
comes back with `ceiling: "low"`, say so in one line before that agent's `Task` call, naming its
source: `ceiling_source`, unless that is `state` (a value already saved from an earlier call), in
which case name `ceiling_origin` instead — the actual reason a saved `low` is in force:

- `config` — a committed project policy in `.somi/config.json`.
- `cli` / `env` — an explicit override, possibly from a previous session.
- `default` — nobody set it.
- `config-stale` — `.somi/config.json`'s `cost.ceiling` was what set this, but that file has since
  changed to a different value (or dropped the setting) — editing config does not itself move a
  ceiling already saved to `.somi/somi-state/ceiling.json`. Say so plainly, and that clearing that
  file (or passing `--ceiling <tier>` / setting `SOMI_COST_CEILING`) is how to pick up the new
  value.
- `unknown` — a saved state file that predates this field entirely; there is no way to recover
  which of the above actually produced it, so say that honestly rather than guessing one.

This is what lets the user raise the ceiling — via `somi_resolve`'s own `ceiling` argument (the CLI
fallback's `--ceiling`) or `SOMI_COST_CEILING` — before work starts, rather than discovering the
reduced depth after the fact.

**In-chat ceiling raise.** If the user asks, mid-session, to raise the ceiling, call `somi_resolve`
again passing `ceiling: <tier>` (or the CLI fallback's `--ceiling <tier>`) the next time you resolve
an agent, and say plainly that the raise **persists**: it is saved to
`.somi/somi-state/ceiling.json` and stays in force for every later resolve this session — and every
later session — until something moves it again.

**No mapped model.** When `model` comes back `null`, pick only from model identifiers **actually
visible to you this turn** — e.g. the subagent tool's own `model` parameter, when it lists
candidates — to match the resolved `tier`: the lightest visible model for `low`, the strongest for
`high`. Say plainly that this is your own choice, not a value the mapping supplied, and pass it to
`Task`. A project's own `.somi/config.json` `cost.mapping` always wins over this when it names one
— this pick applies only when the resolver reported none. **If no model identifiers are visible to
you this turn, pass no model at all and say so**: the agent then runs on its own frontmatter
`model:` or the session's own model, and `cost.mapping` is how a project binds tiers to specific
models on this host — never invent an identifier you cannot actually see. If the host then rejects
a model you *did* pick yourself, retry the same dispatch once without it and say you're doing so
(§5 below) — never silently pass nothing while claiming a choice was made, and never retry more
than once.

## 3. Failures — map each exit code, and stop; never guess a model or tier to keep going

- `64` (usage — bad or missing arguments, including an unrecognized `ceiling`/`--ceiling` or
  `SOMI_COST_CEILING` value, or a malformed `project_dir` — not absolute, doesn't exist, or outside
  a root the host already supplied) — the call itself was malformed; say so and stop.
- `65` (unknown agent) — no file at the install root matches the agent name you named; say so and
  stop, don't dispatch.
- `66` (malformed declaration) — this agent's own `cost:` frontmatter is missing or invalid; quote
  the resolver's own message and stop.
- `67` (project environment/config failure) — either `.somi/config.json` (including a structurally
  invalid `cost.mapping`) or `.somi/somi-state/ceiling.json` is corrupt, unparsable, or
  malformed-shape; or the merged mapping is missing the tier just selected, or holds a non-string
  model value, for a host the project's own `cost.mapping` named (a partial override of a shipped
  host replaces that host's whole tier map, so overriding just one tier drops the others); **or no
  project root could be established at all** — no `project_dir` reached the server as usable, and
  nothing else established one either. For the config/state cases, quote the resolver's own message
  — including the file path when it names one — and tell the user to fix or delete the offending
  config before retrying. For the no-project-root case specifically: **tell the user which folder
  you passed (or tried to pass) as `project_dir` and stop** — this is never silently retried with a
  guessed or different path.

## 4. Last-resort fallback — neither the tool nor a reachable CLI

Reached only when this turn cannot call `somi_resolve` at all **and** there is no shell available
to run the CLI (or SoMi's install path genuinely isn't known) — never when either one is reachable
and simply returned a failure (map that per §3 instead). Say plainly that you're doing this and
name which of the two you couldn't reach, then resolve the same decision manually: read the
ceiling yourself, in the same order the resolver itself would check —
`.somi/somi-state/ceiling.json` if it exists, else `.somi/config.json`'s `cost.ceiling` if set, else
`high` (the shipped default) — then read this agent's `cost:` frontmatter yourself and pick the
highest declared tier at or below that ceiling — the same selection the resolver would have made —
mirroring `/code-loop`'s own no-shell fallback honesty.

## 5. Start the agent

**Resolve right before starting, one agent at a time — except a concurrent batch.** Ordinarily
resolve immediately before the single `Task` call it belongs to, never long in advance and never
once for a whole command. The one exception: when your own procedure calls for **several agent
`Task`s issued together in one turn** so they run concurrently (`/review-panel` seating its lenses
is the shipped example), resolve each one back-to-back, immediately before issuing that batch —
still not once for the whole command, and each still gets its own `project_dir`, model, and
`dispatched at cost: <tier>` line in that agent's own briefing.

1. **State `dispatched at cost: <tier>` in the agent's briefing**, using §1's resolved `tier`
   verbatim — this is the exact phrase `coder`, `planner`, and `refactorer` look for before
   trusting they were dispatched at `low`; without it, their own disclosure instruction can never
   fire.
2. **Pass §2's `model`** — the mapped value, or your own no-mapped-model pick when it applies.
3. **Hand it the scope your own procedure defines** (the iteration, the slug, the target file —
   whatever your own instruction says to pass) — never a paraphrase of the whole command standing
   in for the agent's own prompt.
4. **If the host rejects a model you picked yourself** (§2's no-mapped-model case), retry the same
   dispatch once without a model argument and say you're doing so. A model that came from the
   project's own `cost.mapping` is never retried this way — if the host rejects a **mapped** model,
   fail loudly and say so.

**A dispatched agent's own checkpoints stay in force.** Resolving and starting it never itself
authorizes an outward-facing action a checkpoint still gates — a `gh pr create` confirmation, an
incident framing exchange, a plan's decision round-trip all still happen exactly where the
dispatched agent's or command's own text says they do.

## Failure modes to avoid

- **Guessing a model or a tier when resolution fails**, or when the host rejects the model
  argument. A resolver that was **reached** and answered with an error (§3) is always a stop — map
  the exit code and surface its own message, never fall back to the CLI or to judgment on top of a
  real answer. The §4 judgment fallback exists for a *different* failure: neither `somi_resolve`
  nor a reachable CLI could be called **at all** this turn. Even then it is never silent — say
  plainly which of the two you couldn't reach before resolving by hand.
- **Skipping the `low`-ceiling announcement, or repeating it needlessly.** Once per session, before
  the first agent that resolves to `low` starts — not before every later one, and not skipped just
  because nobody asked again.
- **Passing nothing when the resolver reports no mapped model, without saying so.** A `null` model
  calls for your own pick for that tier when a model identifier is actually visible to you this
  turn, disclosed as a choice — never an invented value passed off as the mapping's own answer, and
  never a silent omission when one genuinely was visible.
- **Dispatching without the `dispatched at cost: <tier>` briefing line.** Without it, the agent's
  own "Running at `low`" disclosure can never fire, even when it should.

## Consumers

Loaded by `agents/somi.md` (the front door, every time its live run of a command's procedure
reaches a point that starts an agent) and by every `commands/*.md` file that Tasks an agent
directly — one line at that point in the command's own procedure pointing here is enough; do not
re-embed this procedure in a command file. `scripts/validate.sh` derives which commands Task an
agent from the real agent names under `agents/` and fails the build if one of them doesn't
reference this skill.
