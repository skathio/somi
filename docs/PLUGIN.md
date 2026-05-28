# Plugin distribution

SoMi AI ships as a Claude Code plugin and as a GitHub Copilot extension. Both use the same
underlying markdown files — agents, commands, skills, rules, hooks — so there is no duplication.

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

The SoMi AI repo is shaped that way: it is both a plugin and its own marketplace.

### Manifests

- [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) — plugin manifest.
- [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) — marketplace manifest
  (lists this plugin so `/plugin marketplace add` resolves it).

### Installing SoMi AI

```text
# 1. Add SoMi AI as a marketplace source.
/plugin marketplace add https://github.com/skathio/somi-ai

# 2. Install the somi-ai plugin.
/plugin install somi-ai@somi-ai

# 3. Check available updates.
/plugin update
```

### Hosting your own marketplace

Fork SoMi AI or wrap it in your own marketplace repo:

```
your-marketplace/
└── .claude-plugin/
    └── marketplace.json
```

Where `marketplace.json` lists SoMi AI (or your fork):

```json
{
  "name": "skathio-claude-tools",
  "description": "Internal Claude Code plugins for skathio.",
  "owner": { "name": "skathio", "url": "https://github.com/skathio" },
  "plugins": [
    {
      "name": "somi-ai",
      "source": "github:skathio/somi-ai",
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
/plugin install somi-ai@skathio-claude-tools
/plugin install skathio-conventions@skathio-claude-tools
```

The two plugins compose at runtime.

### Plugin lifecycle commands

```text
/plugin list                  # shows installed plugins and versions
/plugin update                # update all
/plugin update somi-ai
/plugin pin somi-ai 0.1.0
/plugin unpin somi-ai
/plugin uninstall somi-ai
```

### What a plugin install doesn't do

- It does **not** write a `CLAUDE.md` at your project root. The plugin's `CLAUDE.md` is loaded as
  context but doesn't replace your project's own.
- It does **not** create `.somi/` or any artifacts — those appear when you run the workflows
  (`/plan` creates the first `.somi/plans/<slug>/` directory).
- It does **not** modify your project's `settings.json`. SoMi AI hooks are wired through the plugin's
  own settings.

### Verifying a plugin install

After `/plugin install somi-ai@...`:

- `/plan`, `/code`, `/review` should appear in `/` autocomplete.
- `/agents` should list the SoMi AI agents.
- Try `/plan list a trivial change` — Claude should produce a plan.

---

## GitHub Copilot extension

SoMi AI is also a GitHub Copilot extension, distributed through the same marketplace pattern as
the Claude Code plugin.

### Manifests

- [`.copilot-extension/extension.json`](../.copilot-extension/extension.json) — extension manifest.
- [`.copilot-extension/marketplace.json`](../.copilot-extension/marketplace.json) — marketplace
  manifest (lists this extension so `copilot plugin marketplace add` resolves it).

### Installing

```text
# 1. Add SoMi AI as a marketplace source.
copilot plugin marketplace add https://github.com/skathio/somi-ai

# 2. Install the somi-ai extension.
copilot plugin install somi-ai@somi-ai

# 3. Check for updates.
copilot plugin update
```

### Available commands

| Command                          | Agent(s) used                                                                            |
|----------------------------------|------------------------------------------------------------------------------------------|
| `@somi-ai /plan`                 | `planner`                                                                                |
| `@somi-ai /plan-loop`            | `planner` + `reviewer` (bounded)                                                         |
| `@somi-ai /code`                 | `coder`                                                                                  |
| `@somi-ai /code-loop`            | `coder` + `reviewer` (bounded)                                                           |
| `@somi-ai /review`               | `reviewer` (+ `security-reviewer` / `architecture-reviewer` / `test-strategist` auto-invoked) |
| `@somi-ai /ship`                 | `planner` + (per iteration) `/code-loop`                                                 |
| `@somi-ai /ship-loop`            | `/plan-loop` + (per iteration) `/code-loop`                                              |
| `@somi-ai /security-review`      | `security-reviewer`                                                                      |
| `@somi-ai /architecture-review`  | `architecture-reviewer` (+ `security-reviewer` when relevant)                            |
| `@somi-ai /test-strategy`        | `test-strategist`                                                                        |
| `@somi-ai /refactor`             | `refactorer`                                                                             |

> Plan-level review uses `@somi-ai /review plan <slug>` — there is no separate `/plan-review`.

### Plugin lifecycle

```text
copilot plugin list
copilot plugin update somi-ai
copilot plugin pin somi-ai 0.1.0
copilot plugin uninstall somi-ai
```

### Hosting your own Copilot marketplace

The pattern mirrors the Claude Code marketplace exactly. Add a `.copilot-extension/marketplace.json`
to your org's marketplace repo:

```json
{
  "name": "skathio-copilot-tools",
  "extensions": [
    {
      "name": "somi-ai",
      "source": "github:skathio/somi-ai",
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
2. Compose with SoMi AI — your skills can link to SoMi AI skills, your agents can call SoMi AI agents.
3. List both in your marketplace.

Don't fork SoMi AI for org conventions; **compose** SoMi AI with a sibling plugin. Forks rot.
Composition survives upgrades.
