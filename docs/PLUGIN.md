# Plugin distribution

SoMi ships as a Claude Code plugin and as a GitHub Copilot extension. Both use the same
underlying markdown files — agents, commands, skills, rules, hooks — so there is no duplication.

The hook scripts and state tooling underneath are zero-dependency Node (`.mjs`) — no `bash`, no
`jq` to install on either host, and the runtime itself works the same on Windows, Linux, and
macOS. (One open caveat on Windows path-separator coverage in the path-matching guards: see
[`HOOKS.md`](./HOOKS.md).)

> **The two hosts are not feature-equivalent.** The shared markdown is portable, but there are two
> **layers that don't fully carry to Copilot**: the deterministic **guardrail hooks** run on Copilot
> CLI (checked live on 1.0.103) but are unverified on VS Code Copilot Chat, where you should assume no
> blocking of dangerous bash / secret writes / protected paths, no dep-install gate and no audit log;
> and **concurrent multi-agent orchestration** (the loops and the `/review-panel` / `/code-parallel`
> fan-outs degrade to sequential where the host can't spawn sub-agents). Treat Copilot Chat as the
> **portable subset** — same prompts and judgment, without the enforcement and concurrency layers.
> See the parity caveat in the [`GitHub Copilot extension`](#github-copilot-extension) section below and
> [`HOOKS.md`](./HOOKS.md).

---

## Claude Code plugin

### How plugin install works

Claude Code's `/plugin` command speaks to a **marketplace** (a JSON manifest at a URL or repo)
that lists one or more **plugins**. Each plugin is a directory shaped like:

```
plugin-root/
├── .claude-plugin/
│   └── plugin.json           # plugin manifest (name, version, description, mcpServers, ...)
├── agents/                   # subagents (optional)
├── commands/                 # slash commands (optional)
├── skills/                   # skills (optional)
├── hooks/                    # hook scripts (optional)
└── CLAUDE.md                 # project-context (optional)
```

The SoMi repo is shaped that way: it is both a plugin and its own marketplace.

### Bundled MCP server

[`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json)'s own `mcpServers` field declares
one stdio MCP server, `somi`, launched as `node ${CLAUDE_PLUGIN_ROOT}/scripts/somi-mcp.mjs`. Claude
Code loads a plugin's MCP servers straight from its manifest — no separate root-level `.mcp.json`
is needed, and this repo deliberately doesn't ship one: a root `.mcp.json` is ALSO read as *this
repo's own* project MCP config when a developer opens the SoMi repo itself (as opposed to having
installed it as a plugin elsewhere), where `${CLAUDE_PLUGIN_ROOT}` is undefined and the server
fails to launch. Declaring the server inline in the manifest avoids that collision — there is
nothing at the repo root for a bare checkout to misread. It exposes these tools:

- **`somi_resolve`** — the MCP-native equivalent of `node scripts/somi-dispatch.mjs resolve`:
  given an agent name (and optionally a host/ceiling), returns its dispatch tier and model, plus
  `declared`, `degraded` and `tier_source`. The tier is the agent's `cost.agents` entry in
  `.somi/config.json` if it has one, otherwise the session ceiling itself. A `ceiling` argument
  applies to that call and is remembered, but is outranked whenever the config
  sets `cost.ceiling`, which is read live. A
  failure maps one-to-one onto the CLI's exit-code family (64 usage / 65 unknown agent /
  66 malformed `cost:` / 67 project environment failure), reported in the tool result text.
- **`somi_config`** — the tool behind the [`/somi-config`](../commands/somi-config.md) command: shows the cost settings (the user's [global config](./USAGE.md#the-global-config) with the
  project's `.somi/config.json` merged over it) or changes the project file, by
  running `scripts/somi-config.mjs` (never a shell) and returning its JSON line and exit codes
  unchanged: `show` (every agent's effective tier, plus fixed warnings such as `somi-security-reviewer`
  below `high`), `get`, `set`, `unset`, and `init` (creates the default file only when absent). Only
  `cost.ceiling` and `cost.agents.<name>` can be changed, to `low`/`medium`/`high`; anything else is
  exit 64. A broken existing config (unreadable, oversize, not a regular file, invalid JSON, invalid
  cost block) is exit 67 and nothing is written; `show` and `get` read through a junction or link,
  while `set`, `unset` and `init` refuse a linked `.somi` or `config.json` (67). The tool never writes
  the global config: that is `node scripts/somi-config.mjs ... --global`, for the user to run. Changes are **live**: the config is read on every
  dispatch, so the next resolve sees them. It resolves the project root exactly as `somi_resolve`
  does (`project_dir` narrows a host-supplied root), but `set`, `unset` and `init` need a host-supplied
  root and are refused (exit 67) when only a model-supplied `project_dir` exists; run the CLI yourself
  then. A set or unset refuses (67) a file a rewrite could not reproduce faithfully (duplicate keys, an
  integer beyond the safe range, a number outside the double range) or that would grow past 64 KiB.
  Lowering a tier or remapping a model needs the user: on Claude Code a PreToolUse hook asks before such
  a `set`/`unset`. Anywhere else the tool refuses it with exit 64 and points to the CLI: when
  `CLAUDE_PLUGIN_ROOT` is unset, and on Copilot CLI (`COPILOT_PLUGIN_ROOT` set), which runs SoMi's hooks
  but names this tool `somi-somi_config`, a name the hook's matcher does not catch. On Copilot CLI the
  server also gets no project root of its own, so every write is refused (67) and you run the CLI.
  The CLI is also usable directly:
  `node scripts/somi-config.mjs <show|get|set|unset|init> [key] [value] [--project-dir DIR]`.
- **`somi_agent_info`** — read-only agent registry and dispatch lookup. With no `agent`, the
  catalog: every canonical agent (`somi-coder`, …, and the `somi` front door), the aliases hosts
  actually register for it (today `somi:<name>` on Claude Code and Copilot CLI, the one alias each),
  and its default tier. With `agent` (a canonical name or a registered alias) and `host`: the canonical
  name, the alias that matched, `agent_type` (the id to pass as the host's subagent type), the
  session ceiling and the tier and model the agent would run at now — from the same resolver as
  `somi_resolve`, with nothing written (no ceiling is set or remembered). An unknown identifier is a
  65 and is never routed to another agent; a pre-4.0.0 bare name such as `coder` gets a "renamed"
  hint. Aliases live in one table, `scripts/lib/agent-registry.mjs`, which fails at start on a
  collision.
- **`somi_command`** — returns a SoMi command file (`commands/<name>.md`) from the install root.
  Since 4.1.0 a command is a thin wrapper; its procedure is the `flow-<name>` skill, read with
  `somi_skill`.
- **`somi_skill`** — returns a SoMi skill's own text (`skills/<name>/SKILL.md`) from the install
  root, for the identical reason: a relative markdown link into `skills/` can't be followed from a
  consuming project either, so the [`somi-dispatch`](../skills/somi-dispatch/SKILL.md) skill —
  loaded by every entry path that starts an agent — is readable this way too
  (`somi_skill({name: "somi-dispatch"})`), not only by name on a host that supports Skill-tool
  loading.
- **`somi_agent`** — returns a SoMi agent's instructions (`agents/<name>.md`, frontmatter removed),
  for reading. It is not a dispatch path: every agent starts as its own registered type (see
  [Agent dispatch](#agent-dispatch) below), never as a general-purpose agent carrying this text.

All three readers share the same `^[a-z][a-z0-9-]*$` name allowlist as `somi_resolve`'s `agent`
argument, checked before any of them touches a filesystem path.

Because the server is launched once, from the plugin's own location rather than the consuming
project, it cannot assume its own working directory is the project — see
[`scripts/lib/mcp-project-root.mjs`](../scripts/lib/mcp-project-root.mjs) for the resolution
`somi_resolve` uses to find the right `.somi/`. A HOST-supplied root — `CLAUDE_PROJECT_DIR`, or a
single MCP `roots` entry the client offers — is used directly when no `project_dir` tool argument
is given; when both are present, `project_dir` (text a MODEL supplied) must be that host root or a
directory inside it, or the call is refused before anything is read or written — a model cannot
point the server somewhere the host didn't authorize. Only when the host supplies nothing at all
does `project_dir` alone decide. No usable root at all is a clear refusal, never a silent fallback
to SoMi's own directory. `scripts/somi-dispatch.mjs` (the CLI) stays as the test harness and as the
fallback for a host with a shell but no MCP client.

### Manifests

- **`somi_tier`** — sizes a request: runs `scripts/somi-tier.mjs resolve` on the `signals` you pass (optional `override`, only after a human reply) and returns its JSON line and exit codes (64 input, 65 refused below the security floor). Its schema lists the rubric's signal ids (exact names, each with `value` and `evidence`); names it does not know come back as `unrecognized` next to `expected`. It writes no record; the approval stamp needs the CLI. Rubric: the `somi-routing` skill, Size tiers.
- [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) — plugin manifest.
- [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) — marketplace manifest
  (lists this plugin so `/plugin marketplace add` resolves it).

### Installing SoMi

```text
# 1. Add SoMi as a marketplace source.
/plugin marketplace add https://github.com/skathio/somi

# 2. Install the somi plugin.
/plugin install somi@somi

# 3. Check available updates.
/plugin update
```

### Hosting your own marketplace

Fork SoMi or wrap it in your own marketplace repo:

```
your-marketplace/
└── .claude-plugin/
    └── marketplace.json
```

Where `marketplace.json` lists SoMi (or your fork):

```json
{
  "name": "skathio-claude-tools",
  "description": "Internal Claude Code plugins for skathio.",
  "owner": { "name": "skathio", "url": "https://github.com/skathio" },
  "plugins": [
    {
      "name": "somi",
      "source": "github:skathio/somi",
      "version": "0.1.0",
      "description": "Plan / code / review workflow system.",
      "tags": ["workflow", "review", "security"]
    },
    {
      "name": "skathio-conventions",
      "source": "github:skathio/skathio-conventions",
      "version": "1.0.0",
      "description": "skathio-specific Claude conventions."
    }
  ]
}
```

Teams then run:

```text
/plugin marketplace add https://github.com/skathio/your-marketplace
/plugin install somi@skathio-claude-tools
/plugin install skathio-conventions@skathio-claude-tools
```

The two plugins compose at runtime.

### Plugin lifecycle commands

```text
/plugin list                  # shows installed plugins and versions
/plugin update                # update all
/plugin update somi
/plugin pin somi 0.1.0
/plugin unpin somi
/plugin uninstall somi
```

### What a plugin install doesn't do

- It does **not** write a `CLAUDE.md` at your project root. The plugin's `CLAUDE.md` is loaded as
  context but doesn't replace your project's own.
- It does **not** create `.somi/` or any artifacts — those appear when you run the workflows
  (`/plan` creates the first `.somi/plans/<slug>/` directory).
- It does **not** modify your project's `settings.json`. SoMi hooks are wired through the plugin's
  own settings.

### Verifying a plugin install

After `/plugin install somi@...`:

- `/discover`, `/plan`, `/code`, `/review` should appear in `/` autocomplete.
- `/agents` should list the SoMi agents.
- Try `/plan list a trivial change` — Claude should produce a plan.

---

## GitHub Copilot extension

SoMi is also a GitHub Copilot extension, distributed through the same marketplace pattern as
the Claude Code plugin.

> **Parity caveat.** Copilot gets the commands, agents, skills, rules, and templates. The hook-enforced
> guardrails (dangerous-bash / secret-write / protected-path blocks, dep-install gating, audit log)
> run on Copilot CLI (checked live on 1.0.103, including its own file-tool shapes: `Write` with
> `path`, `Edit` carrying an `apply_patch` body) but are unverified on other Copilot surfaces; and it
> does **not** get concurrent
> sub-agent orchestration (the loops and the `/review-panel` / `/code-parallel` parallel fan-outs run
> sequentially when the host can't spawn sub-agents). The judgment layer is identical; the
> concurrency layer is Claude Code-only, and the enforcement layer is Claude Code and Copilot CLI.
> Don't rely on the hard stops on other Copilot surfaces — and on any host, install [`scripts/somi-check.mjs`](../scripts/somi-check.mjs) as a git pre-commit hook / CI
> step: it carries the working-tree subset of the guarantees (staged secrets, lockfile hand-edits,
> loose-end markers) to any host. See [`HOOKS.md`](./HOOKS.md#somi-check--the-portable-working-tree-guard).

### Manifests

- [`.copilot-extension/extension.json`](../.copilot-extension/extension.json) — extension manifest.
- [`.copilot-extension/marketplace.json`](../.copilot-extension/marketplace.json) — marketplace
  manifest (lists this extension so `copilot plugin marketplace add` resolves it).
- [`mcp.json`](../mcp.json) — the same bundled MCP server as Claude Code's manifest-declared one
  (see ["Bundled MCP server"](#bundled-mcp-server) above), launched as
  `node ${PLUGIN_ROOT}/scripts/somi-mcp.mjs`. Copilot CLI auto-loads a plugin's root-level
  `mcp.json` — unlike Claude Code, which reads its server declarations out of
  `.claude-plugin/plugin.json` itself, so this file stays at the repo root without the same
  bare-checkout collision (Copilot has no equivalent "open this plugin's own repo as a project"
  auto-load path this repo has hit). No reference from `extension.json` is needed. Tool naming
  inside an agent's own reasoning isn't documented for Copilot; refer to `somi_resolve` /
  `somi_agent_info` / `somi_command` / `somi_skill` / `somi_agent` by their bare names — a host may surface them namespaced by plugin
  and server (as Claude Code does).

### Installing

```text
# 1. Add SoMi as a marketplace source.
copilot plugin marketplace add https://github.com/skathio/somi

# 2. Install the somi extension.
copilot plugin install somi@somi

# 3. Check for updates.
copilot plugin update
```

Install it once per machine. VS Code can also install it as an agent plugin under
`~/.vscode/agent-plugins/`. When both copies are present, Copilot loads the first one it finds and
logs `plugin name "somi" already loaded ... skipping` for the other, so updating only one copy may
have no effect.

### Selecting an agent

Copilot requires selecting one agent to drive the whole session. SoMi ships phase-specific experts
(see [`docs/AGENTS.md`](./AGENTS.md)) that assume you already know which phase you're in, and one
generic front door, **`somi`**. Select `somi` when you're not sure. It is a dispatcher, not a
worker: bare `@somi` shows the status dashboard, an explicit command or a free-form request is
matched to one workflow and handed to the **`somi-flow`** runner (through the same cost resolver a
direct command uses), and anything that matches no workflow goes to **`somi-general`**. The runner
loads the workflow's `flow-<name>` skill and starts its specialists one level further down, so the
whole chain stays two levels below the session, within Copilot CLI's nesting. A subagent cannot ask
you anything, so each question a workflow needs comes back through `somi` as a checkpoint: answer
it and the runner resumes. On Claude Code the direct commands run the same flow skills themselves,
so `somi` mainly matters here, on Copilot. From the command line the agent's id is the plugin-namespaced one:
`copilot --agent somi:somi` (a bare `--agent somi` is refused with "No such agent").

### Agent dispatch

Every SoMi agent starts as the subagent type the host itself registered for it. Both supported
hosts namespace plugin agents as `<plugin>:<file stem>`, so the type is `somi:somi-<name>`
(`somi:somi-coder`, `somi:somi-reviewer`, …). `somi_resolve` returns it as `agent_type`, and the
[`somi-dispatch`](../skills/somi-dispatch/SKILL.md) skill passes it together with the resolved model.

| Host | Dispatch |
|---|---|
| Claude Code | Native: the Task tool takes `somi:somi-<name>`. |
| GitHub Copilot CLI | Native: the task tool takes `somi:somi-<name>` once the plugin is installed and enabled. Checked against the CLI's own plugin loader (1.0.70); a bare `somi-coder` is `Unknown agent_type`. |
| VS Code Copilot Chat | Not a supported dispatch host. An earlier release found its subagent tool refused plugin agents; if it refuses `somi:somi-<name>`, SoMi stops and says which agent could not start, instead of running a stand-in. Not re-tested with the `somi:` ids. |

There is no fallback that hands an agent's text to a general-purpose agent (3.1.0 had one; 4.0.0
removes it): a run either starts the real agent, from a fresh context, or stops with the canonical
name, the type it tried, and the host's reason. When dispatch fails on Copilot CLI, check that the
plugin is enabled (`copilot plugin list`) and that the agent is not turned off in `/subagents`.

### Available commands

| Command                          | Agent(s) used                                                                            |
|----------------------------------|------------------------------------------------------------------------------------------|
| `@somi /discover`             | `somi-discovery-analyst` (greenfield: research + requirements & design → `.somi/rd/<slug>/`)  |
| `@somi /design`               | `somi-designer` (brownfield feature design → `brief.md`)                                      |
| `@somi /atlas`                | `somi-atlas` (repo map → `.somi/atlas.md`)                                                     |
| `@somi /plan`                 | `somi-planner`                                                                                |
| `@somi /plan-loop`            | `somi-planner` + `somi-reviewer` (bounded)                                                         |
| `@somi /code`                 | `somi-coder`                                                                                  |
| `@somi /code-loop`            | `somi-coder` + `somi-reviewer` (bounded)                                                           |
| `@somi /code-parallel`        | per eligible iteration: `/code-loop` (sequential on Copilot — no worktrees/concurrency)   |
| `@somi /debug`                | `somi-coder` (+ `somi-reviewer` as high-cost diagnosis hatch)                                            |
| `@somi /review`               | `somi-reviewer` (+ `somi-security-reviewer` / `somi-architecture-reviewer` / `somi-test-strategist` auto-invoked) |
| `@somi /review-panel`         | reviewer + specialist lenses (sequential on Copilot)                                     |
| `@somi /ship`                 | `somi-planner` + (per iteration) `/code-loop`                                                 |
| `@somi /ship-loop`            | `/plan-loop` + (per iteration) `/code-loop`                                              |
| `@somi /security-review`      | `somi-security-reviewer`                                                                      |
| `@somi /architecture-review`  | `somi-architecture-reviewer` (+ `somi-security-reviewer` when relevant)                            |
| `@somi /test-strategy`        | `somi-test-strategist`                                                                        |
| `@somi /refactor`             | `somi-refactorer`                                                                             |
| `@somi /refactor-design`      | `somi-refactor-designer`                                                                      |
| `@somi /impact`               | `somi-impact` (read-only blast-radius analysis)                                               |
| `@somi /adopt`                | `somi-atlas` agent (+ `somi-test-strategist` for depth)                                            |
| `@somi /upgrade`              | `somi-discovery-analyst` (research) + `/code-loop` (migration)                                |
| `@somi /release-readiness`    | `somi-reviewer` (one integration pass; the checklist is deterministic)                        |
| `@somi /incident`             | `somi-incident` (mitigation inline; seeds `/debug` / `/plan` after)                            |
| `@somi` (bare)                | (none — status dashboard, read-only)                                                     |
| `@somi /pr`                   | `somi-pr` (composes the PR from artifacts; `gh` after confirmation)                            |

> On Copilot the loop caps fall back to judgment-enforced tracking when the host can't run the
> `scripts/somi-loop.mjs` / `somi-findings.mjs` helpers — and `scripts/somi-check.mjs` (below) is
> the enforcement layer that *does* work here.

> Plan-level review uses `@somi /review plan <slug>` — there is no separate `/plan-review`.

> There is no separate `/somi` command. An earlier version registered both a `somi` agent and a
> `somi` command; on Copilot the two were indistinguishable at dispatch time, so an invocation
> like `@somi /ship-loop feature` (which Copilot sends as `/somi ship-loop feature`) got
> misread as an explicit `/somi` and permanently short-circuited into a recommend-only router
> that never ran `/ship-loop`. The fix folded the dashboard and router directly into the `somi`
> **agent** — see the maintainer note in [`agents/somi.md`](../agents/somi.md).

### Plugin lifecycle

```text
copilot plugin list
copilot plugin update somi
copilot plugin pin somi 0.1.0
copilot plugin uninstall somi
```

### Hosting your own Copilot marketplace

The pattern mirrors the Claude Code marketplace exactly. Add a `.copilot-extension/marketplace.json`
to your org's marketplace repo:

```json
{
  "name": "skathio-copilot-tools",
  "extensions": [
    {
      "name": "somi",
      "source": "github:skathio/somi",
      "version": "0.1.0"
    }
  ]
}
```

Then: `copilot plugin marketplace add https://github.com/skathio/your-marketplace`.

---

## Building your own plugin on top

The pattern for an org-specific plugin (e.g., `skathio-conventions`):

1. New repo with the plugin shape (`.claude-plugin/plugin.json` + agents/commands/skills/hooks).
2. Compose with SoMi — your skills can link to SoMi skills, your agents can call SoMi agents.
3. List both in your marketplace.

Don't fork SoMi for org conventions; **compose** SoMi with a sibling plugin. Forks rot.
Composition survives upgrades.
