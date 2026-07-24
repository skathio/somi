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
│   └── plugin.json           # plugin manifest (name, version, description, ...)
├── agents/                   # subagents (optional)
├── commands/                 # slash commands (optional)
├── skills/                   # skills (optional)
├── hooks/                    # hook scripts (optional)
└── CLAUDE.md                 # project-context (optional)
```

The SoMi repo is shaped that way: it is both a plugin and its own marketplace.

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

Copilot requires selecting one agent to drive the whole session. SoMi ships ten: nine
phase-specific experts (see [`docs/AGENTS.md`](./AGENTS.md)) that assume you already know which
phase you're in, and one generic front door, **`somi`**. Select `somi` when you're not sure —
it recognizes an explicit command and proxies it, passes `/somi` straight through, and
classifies free-form requests into the matching flow, carrying it inline (adopt-inline — no
sub-agent `Task`, per the parity caveat above). On Claude Code the direct commands already
select the right agent, so `somi` mainly matters here, on Copilot.

### Available commands

| Command                          | Agent(s) used                                                                            |
|----------------------------------|------------------------------------------------------------------------------------------|
| `@somi /discover`             | `discovery-analyst` (greenfield: research + requirements & design → `.somi/rd/<slug>/`)  |
| `@somi /design`               | `designer` (brownfield feature design → `brief.md`)                                      |
| `@somi /atlas`                | (none — MAX command; repo map → `.somi/atlas.md`)                                        |
| `@somi /plan`                 | `planner`                                                                                |
| `@somi /plan-loop`            | `planner` + `reviewer` (bounded)                                                         |
| `@somi /code`                 | `coder`                                                                                  |
| `@somi /code-loop`            | `coder` + `reviewer` (bounded)                                                           |
| `@somi /code-parallel`        | per eligible iteration: `/code-loop` (sequential on Copilot — no worktrees/concurrency)   |
| `@somi /debug`                | `coder` (+ `reviewer` as MAX diagnosis hatch)                                            |
| `@somi /review`               | `reviewer` (+ `security-reviewer` / `architecture-reviewer` / `test-strategist` auto-invoked) |
| `@somi /review-panel`         | reviewer + specialist lenses (sequential on Copilot)                                     |
| `@somi /ship`                 | `planner` + (per iteration) `/code-loop`                                                 |
| `@somi /ship-loop`            | `/plan-loop` + (per iteration) `/code-loop`                                              |
| `@somi /security-review`      | `security-reviewer`                                                                      |
| `@somi /architecture-review`  | `architecture-reviewer` (+ `security-reviewer` when relevant)                            |
| `@somi /test-strategy`        | `test-strategist`                                                                        |
| `@somi /refactor`             | `refactorer`                                                                             |
| `@somi /impact`               | (none — read-only blast-radius analysis)                                                 |
| `@somi /adopt`                | `/atlas` flow (+ `test-strategist` for depth)                                            |
| `@somi /upgrade`              | `discovery-analyst` (research) + `/code-loop` (migration)                                |
| `@somi /release-readiness`    | `reviewer` (one integration pass; the checklist is deterministic)                        |
| `@somi /incident`             | (mitigation inline; seeds `/debug` / `/plan` after)                                      |
| `@somi /somi`                 | (none — status dashboard & router, read-only)                                            |
| `@somi /pr`                   | (none — composes the PR from artifacts; `gh` after confirmation)                         |

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
