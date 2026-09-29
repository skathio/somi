# Plugin distribution

SoMi ships as a Claude Code plugin and as a GitHub Copilot extension. Both use the same
underlying markdown files — agents, commands, skills, rules, hooks — so there is no duplication.

The hook scripts and state tooling underneath are zero-dependency Node (`.mjs`) — no `bash`, no
`jq` to install on either host, and the runtime itself works the same on Windows, Linux, and
macOS. (One open caveat on Windows path-separator coverage in the path-matching guards: see
[`HOOKS.md`](./HOOKS.md).)

> **The two hosts are not feature-equivalent.** The shared markdown is portable, but two layers are
> **Claude Code capabilities that don't carry to Copilot**: the deterministic **guardrail hooks**
> (they don't fire on Copilot — no blocking of dangerous bash / secret writes / protected paths, no
> dep-install gate, no audit log) and **concurrent multi-agent orchestration** (the loops and the
> `/review-panel` / `/code-parallel` fan-outs degrade to sequential where the host can't spawn
> sub-agents). Treat the Copilot extension as the **portable subset** — same prompts and judgment,
> without the enforcement and concurrency layers. See the parity caveat in the
> [`GitHub Copilot extension`](#github-copilot-extension) section below and [`HOOKS.md`](./HOOKS.md).

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
nothing at the repo root for a bare checkout to misread. It exposes two tools:

- **`somi_resolve`** — the MCP-native equivalent of `node scripts/somi-dispatch.mjs resolve`:
  given an agent name (and optionally a host/ceiling), returns its dispatch tier and model. A
  failure maps one-to-one onto the CLI's exit-code family (64 usage / 65 unknown agent /
  66 malformed `cost:` / 67 project environment failure), reported in the tool result text.
- **`somi_command`** — returns a SoMi command's own procedure text (`commands/<name>.md`) from
  the install root, so the front door can run a command live without knowing an install path.

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

> **Parity caveat.** Copilot gets the commands, agents, skills, rules, and templates — but **not** the
> hook-enforced guardrails (dangerous-bash / secret-write / protected-path blocks, dep-install
> gating, audit log are Claude Code `hooks` and simply don't run here) and **not** concurrent
> sub-agent orchestration (the loops and the `/review-panel` / `/code-parallel` parallel fan-outs run
> sequentially when the host can't spawn sub-agents). The judgment layer is identical; the
> enforcement and concurrency layers are Claude Code-only. Don't rely on the hard stops on Copilot —
> but do install [`scripts/somi-check.mjs`](../scripts/somi-check.mjs) as a git pre-commit hook / CI
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
  `somi_command` by their bare names — a host may surface them namespaced by plugin and server (as
  Claude Code does).

### Installing

```text
# 1. Add SoMi as a marketplace source.
copilot plugin marketplace add https://github.com/skathio/somi

# 2. Install the somi extension.
copilot plugin install somi@somi

# 3. Check for updates.
copilot plugin update
```

### Selecting an agent

Copilot requires selecting one agent to drive the whole session. SoMi ships phase-specific experts
(see [`docs/AGENTS.md`](./AGENTS.md)) that assume you already know which phase you're in, and one
generic front door, **`somi`**. Select `somi` when you're not sure —
it recognizes an explicit command and proxies it, passes `/somi` straight through, and
classifies free-form requests into the matching flow, then **runs that flow's own procedure live,
in the same turn** — resolving and `Task`ing every agent the flow starts through the same cost
resolver a direct command uses, the same way a command body dispatches on Claude Code. On Claude
Code the direct commands already select the right agent and run their own procedure themselves, so
`somi` mainly matters here, on Copilot.

### Available commands

| Command                          | Agent(s) used                                                                            |
|----------------------------------|------------------------------------------------------------------------------------------|
| `@somi /discover`             | `discovery-analyst` (greenfield: research + requirements & design → `.somi/rd/<slug>/`)  |
| `@somi /design`               | `designer` (brownfield feature design → `brief.md`)                                      |
| `@somi /atlas`                | `atlas` (repo map → `.somi/atlas.md`)                                                     |
| `@somi /plan`                 | `planner`                                                                                |
| `@somi /plan-loop`            | `planner` + `reviewer` (bounded)                                                         |
| `@somi /code`                 | `coder`                                                                                  |
| `@somi /code-loop`            | `coder` + `reviewer` (bounded)                                                           |
| `@somi /code-parallel`        | per eligible iteration: `/code-loop` (sequential on Copilot — no worktrees/concurrency)   |
| `@somi /debug`                | `coder` (+ `reviewer` as high-cost diagnosis hatch)                                            |
| `@somi /review`               | `reviewer` (+ `security-reviewer` / `architecture-reviewer` / `test-strategist` auto-invoked) |
| `@somi /review-panel`         | reviewer + specialist lenses (sequential on Copilot)                                     |
| `@somi /ship`                 | `planner` + (per iteration) `/code-loop`                                                 |
| `@somi /ship-loop`            | `/plan-loop` + (per iteration) `/code-loop`                                              |
| `@somi /security-review`      | `security-reviewer`                                                                      |
| `@somi /architecture-review`  | `architecture-reviewer` (+ `security-reviewer` when relevant)                            |
| `@somi /test-strategy`        | `test-strategist`                                                                        |
| `@somi /refactor`             | `refactorer`                                                                             |
| `@somi /refactor-design`      | `refactor-designer`                                                                      |
| `@somi /impact`               | `impact` (read-only blast-radius analysis)                                               |
| `@somi /adopt`                | `atlas` agent (+ `test-strategist` for depth)                                            |
| `@somi /upgrade`              | `discovery-analyst` (research) + `/code-loop` (migration)                                |
| `@somi /release-readiness`    | `reviewer` (one integration pass; the checklist is deterministic)                        |
| `@somi /incident`             | `incident` (mitigation inline; seeds `/debug` / `/plan` after)                            |
| `@somi /somi`                 | (none — status dashboard & router, read-only)                                            |
| `@somi /pr`                   | `pr` (composes the PR from artifacts; `gh` after confirmation)                            |

> On Copilot the loop caps fall back to judgment-enforced tracking when the host can't run the
> `scripts/somi-loop.mjs` / `somi-findings.mjs` helpers — and `scripts/somi-check.mjs` (below) is
> the enforcement layer that *does* work here.

> Plan-level review uses `@somi /review plan <slug>` — there is no separate `/plan-review`.

> The `somi` **agent** — a selectable persona, distinct from the `@somi /somi` **command** row
> above — is the recommended default agent selection for a Copilot session. See "Selecting an
> agent" above.

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
