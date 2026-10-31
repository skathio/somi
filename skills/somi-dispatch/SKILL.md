---
name: somi-dispatch
description: The one canonical procedure for resolving and starting any SoMi agent — call `somi_resolve`, honour the fallback order, map the result onto a `Task` call carrying the resolved tier and model, and announce a `low` session ceiling once per session. Loaded by the front door and by every command that Tasks an agent directly — edit only here.
---

# somi-dispatch — resolve, then start, one agent

This is the single canonical procedure for turning "start agent X" into a real `Task` call —
resolving its cost tier and model against the session ceiling first, every time, on every entry
path. The `somi` dispatcher, the `somi-flow` runner and every flow procedure that Tasks an agent load this skill
instead of carrying their own copy of it — editing it once here keeps every entry path in sync,
which is the whole reason this skill exists (the same precedent `skills/somi-routing` sets).

## When this applies

Whenever your own procedure is about to start an agent via `Task` — whether that's the only agent
a simple flow Tasks, one of several a multi-agent flow seats in turn, or the `somi-flow` /
`somi-general` agent the dispatcher starts. It does **not** apply to a `Task` line that
names another *command* (`Task /code-loop`, `Task /review-panel`, …) — a command is not an agent
and there is nothing here to resolve for it; load that command's `flow-<name>` skill and run it
in place, and let its own agent-Tasks reach this skill in turn.

**A re-invocation resolves fresh too, every time, the same as a first start.** The planner,
designer, discovery-analyst, and refactor-designer are all re-invoked in authoring mode after a
`DECISIONS-NEEDED` round-trip pauses for the user (`flow-plan`, `flow-design`, `flow-discover`,
`flow-refactor-design`) — that pause is exactly when a user is
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

**Pass `ceiling` only when the user actually asked, in this turn, to change the session ceiling —
or asked earlier in this conversation while `cost.ceiling` is set and no config write happened.**
It applies to that resolve and is remembered as an explicitly set value, but a `cost.ceiling` in
`.somi/config.json` is read live on every resolve and outranks a remembered value — so where the
config sets one, a ceiling passed here does **not** last. Omit it on every ordinary resolve. A `ceiling` below the one
now in force needs the user's confirmation (the host will ask them); never pass one they did not ask for.

**Name the agent canonically** (`somi-coder`, `somi-reviewer`, …). When the identifier came from
somewhere else (a user typed `somi:somi-coder`, or an old name like `coder`), first call the read-only
`somi_agent_info` tool: `somi_agent_info({ agent: "<identifier>", host: "<host>", project_dir: "<project>" })`. It returns the
`canonical_name` to resolve, or a 65 for an unknown identifier. Stop on a 65 and relay its message
(it names the 4.0.0 rename when that is the cause); never substitute a different agent.

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
{"agent": "somi-coder", "agent_type": "somi:somi-coder", "supported": ["medium"], "declared": ["medium"], "tier": "medium", "tier_source": "ceiling", "degraded": false, "model": "<mapped model>", "enforced": true, "ceiling": "medium", "ceiling_source": "default", "ceiling_origin": "default"}
```

- `tier` — the tier selected now: the agent's `cost.agents` entry if it has one (`tier_source:
  "override"`), else the ceiling (`tier_source: "ceiling"`). The ceiling is a hard cap for every agent
  without an override.
- `declared` (same as `supported`) — the agent's default tier, one element (`scripts/lib/cost-defaults.mjs`);
  `degraded` is `true` when `tier` is below it.
- `model` — pass it to `Task` when non-null; with `model_candidates` (a `cost.mapping` preference list),
  pass the first candidate the subagent tool's own model list offers, else `model`. An unresolved launch
  inherits the session's model, so always pass the resolved one.
- `enforced` — `true` only when `model` is a concrete id from a mapping. `false`: nothing pins this tier on
  this host, `reason` says why (e.g. `no model mapping for host copilot`), and the tier is only *requested*,
  never a claim about what ran.
- `ceiling` / `ceiling_source` / `ceiling_origin` — for the announcement below.
- `warnings` — repeat each verbatim; never drop or soften one.

**`degraded`: one line before the `Task`:** `running <agent> at <tier> (default <default tier>)`, e.g.
`running somi-security-reviewer at medium (default high)` — the hard cap working as designed, made visible.

**A `low` ceiling: announce it once per session, before the first agent it applies to starts.** "Once"
means once in the context you can currently see: a repeat after a compaction or inside a Tasked command's
fresh context is fine. Name its source: `ceiling_source`, or `ceiling_origin` when the source is `state` (an
earlier explicit value). `config` is `cost.ceiling` in `.somi/config.json`, read live; `cli` / `env` is an
explicit override (`--ceiling`, `SOMI_COST_CEILING`, or `somi_resolve`'s `ceiling`), possibly remembered.
This lets the user raise the ceiling before work starts.

**Changing the ceiling mid-session** is `/somi-config`'s job (or `somi_config` `set cost.ceiling`): it lives
in `cost.ceiling`, which outranks a remembered value. Say it is saved only after the tool returns success;
if the tool is unreachable, tell the user to set it themselves. Lowering any tier, above all
`somi-security-reviewer`'s, needs the user; a refusal (exit `64`) is not worked around.

**No mapped model — which rule wins.** When `enforced` is `false`, first match wins, and the briefing (§5)
reports what happened, never what was hoped for:

1. **A `cost.mapping` entry** — the resolver already applied it (`model` non-null, `enforced: true`). Pass
   it: a configured mapping counts as the user naming the model, so a host rule "do not set `model` unless
   the user names one" does **not** block it.
2. **The host's own guidance** — if it says not to set a model unless the user names one, pass none and
   state `requested cost: <tier> (not enforced: no mapped model)`; `cost.mapping` is how to pin one.
3. **Your own pick** — only from model ids **visible to you this turn** (e.g. the subagent tool's `model`
   parameter): the lightest for `low`, the strongest for `high`. Say it is your choice; `enforced` stays
   `false`, so use the `requested cost:` line. No ids visible: pass none and say so. Never invent one.

`null` is expected on Copilot, which ships no mapping because its ids vary by plan and editor.

**Unenforced notice, then the picker.** When `enforced` is `false` and `tier` is `high`, print ONE
user-visible line per agent type per session before its `Task`: `<agent> is high-tier but no model is pinned
on <host>, so its model was not chosen by SoMi.` The first time in a session, offer the `/somi-config` model
picker (one question per tier from the ids you can see, or "use the host default this session", which ends
the asking) before continuing; never pick and save models without it. Lower tiers get the briefing line
only. If the host rejects a model you picked yourself, retry once without it and say so (§5).

## 3. Failures — map each exit code, and stop; never guess a model or tier to keep going

- `64` (usage — bad or missing arguments, including an unrecognized `ceiling`/`--ceiling` or
  `SOMI_COST_CEILING` value, or a malformed `project_dir` — not absolute, doesn't exist, or outside
  a root the host already supplied) — the call itself was malformed; say so and stop.
- `65` (unknown agent) — no file at the install root matches the agent name you named; say so and
  stop, don't dispatch.
- `66` (no tier source) — the agent is the exempt `somi`, or its file has no entry in the default
  tier table; quote the resolver's own message and stop.
- `67` (project environment/config failure) — either `.somi/config.json` (including a structurally
  invalid `cost.mapping`, `cost.agents`, or an oversize, symlinked or non-regular file) or
  `.somi/somi-state/ceiling.json` is corrupt, unparsable, or malformed-shape; or the merged mapping
  is missing the tier just selected, or holds a non-string
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
ceiling and the tier yourself, in the same order the resolver itself would: a ceiling the user
asked for in this conversation (you cannot see `SOMI_COST_CEILING` without a shell), then this
agent's
`cost.agents.<agent>` entry in `.somi/config.json` if it has one, else the ceiling — `cost.ceiling`
in `.somi/config.json` if set, else a ceiling the user explicitly set earlier in
`.somi/somi-state/ceiling.json` (only if it records `cli` or `env` as its origin), else `medium`
(the shipped default). That tier is the answer; the agent's default tier does not change it,
though if the tier is below the agent's default tier, say so as in §2. Nothing was resolved against a mapping here, so nothing is enforced: the
briefing's cost line is `requested cost: <tier> (not enforced: no mapped model)`, never
`dispatched at cost:`.

## 5. Start the agent

**Resolve right before starting, one agent at a time — except a concurrent batch.** Ordinarily
resolve immediately before the single `Task` call it belongs to, never long in advance and never
once for a whole command. The one exception: when your own procedure calls for **several agent
`Task`s issued together in one turn** so they run concurrently (`/review-panel` seating its lenses
is the shipped example), resolve each one back-to-back, immediately before issuing that batch —
still not once for the whole command, and each still gets its own `project_dir`, model, and
cost briefing line in that agent's own briefing.

Every entry path that starts an agent states this step in one canonical phrase, copied verbatim
(`tests/scripts/dispatch-line-gate.sh` holds each copy to it):

<!-- dispatch-line:start -->
pass its `model`, start it as its `agent_type`, and put the cost line in the briefing (`dispatched at cost: <tier>` only when `enforced` is true, else `requested cost: <tier> (not enforced: no mapped model)`)
<!-- dispatch-line:end -->

1. **Start the agent as its `agent_type`** (`somi:somi-coder`): the type the host itself registered,
   on Claude Code and Copilot CLI alike — never a bare name, never a general-purpose agent carrying
   the agent's text, never its role played inline. The real agent runs, from a fresh context.
2. **State the cost line in the agent's briefing**, using §1's resolved `tier` verbatim. When
   `enforced` is `true`: `dispatched at cost: <tier>`. When it is `false`:
   `requested cost: <tier> (not enforced: no mapped model)` — **`dispatched at cost:` is
   reserved for enforced dispatches**, so a briefing never claims a tier no model was pinned to.
   `somi-coder`, `somi-planner`, and `somi-refactorer` take their "Running at `low`" trim from **either** line
   (`dispatched at cost: low` or `requested cost: low`) — the trim is about the procedure, not the
   model, so it follows the requested tier; without a cost line, their disclosure instruction can
   never fire.
3. **Pass §2's `model`** — the mapped value, or your own no-mapped-model pick when it applies.
4. **Hand it the scope your own procedure defines** (the iteration, the slug, the target file —
   whatever your own instruction says to pass) — never a paraphrase of the whole command standing
   in for the agent's own prompt. When the procedure printed a run card (`somi-card.mjs`), it goes
   first in the briefing, byte for byte, before the cost line and the scope.
5. **If the host rejects a model you picked yourself** (§2's no-mapped-model case), retry the same
   dispatch once without a model argument and say you're doing so. A **mapped** model is never
   dropped this way: if the host rejects it, try the next `model_candidates` entry, and when none is
   left, fail loudly and say so.
6. **If the agent cannot be started as its `agent_type`** — `agent_type` is `null` (a host with no
   registration), or the host rejects the type (`Unknown agent_type`, a disabled subagent, the plugin
   not installed or not enabled) — **stop**. Tell the user, in one line, which canonical agent could
   not start, as which type, on which host, and the host's reason (`could not start somi-coder as
   somi:somi-coder on copilot: Unknown agent_type`). Never substitute an agent, run its procedure
   yourself, or report the step done. The fix is host-side: enable the plugin, or check `/subagents`.

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
- **Dispatching without a cost briefing line.** Without `dispatched at cost: <tier>` or `requested
  cost: <tier>`, the agent's own "Running at `low`" disclosure can never fire, even when it should.
- **Starting a stand-in.** A general-purpose or built-in agent given the SoMi agent's text, a bare or
  pre-4.0.0 name as the type, or the agent's procedure run inline when its `agent_type` was refused:
  each hides which agent actually ran. Stop and report it instead (§5, step 6).
- **Writing `dispatched at cost: <tier>` for an unenforced dispatch** (`enforced: false`), or staying
  silent about a high-tier agent whose model nothing pinned. Use `requested cost: <tier> (not enforced: no mapped model)` and print the unenforced notice (§2).

## Consumers

Loaded by `agents/somi.md` (the dispatcher, before it starts `somi-flow` or `somi-general`), by
`agents/somi-flow.md`, and by every `skills/flow-*/SKILL.md` procedure that Tasks an agent
directly — one line at that point in the procedure pointing here is enough; do not re-embed this
procedure in a flow skill. `scripts/validate.sh` derives which flow skills Task an agent from the
real agent names under `agents/` and fails the build if one of them doesn't reference this skill.
