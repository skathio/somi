# Plugin distribution

SOMI is also a Claude Code **plugin** and can be distributed through Claude Code's plugin/marketplace
mechanism. This is the cleanest path for orgs that want versioned, manageable, optional installs
across many teams.

## How plugin install works

Claude Code's `/plugin` command speaks to a **marketplace** (a JSON manifest at a URL or repo path)
that lists one or more **plugins**. Each plugin is a directory shaped like:

```
plugin-root/
├── .claude-plugin/
│   └── plugin.json           # plugin manifest (name, version, description, ...)
├── agents/                   # subagents (optional)
├── commands/                 # slash commands (optional)
├── skills/                   # skills (optional)
├── hooks/                    # hook scripts (optional)
├── mcp.json                  # MCP servers (optional)
└── CLAUDE.md                 # project-context (optional)
```

SOMI is shaped that way. The SOMI repo *is* a plugin and *is* its own marketplace.

## Files

- [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) — plugin manifest.
- [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) — marketplace manifest
  (lists this plugin so `/plugin marketplace add` resolves it).

## Adding SOMI to Claude Code as a plugin

```text
# 1. Add SOMI as a marketplace source.
/plugin marketplace add https://github.com/your-org/somi-ai

# 2. Install the somi-ai plugin from that marketplace.
/plugin install somi-ai@somi-ai

# 3. (Optionally) check available updates.
/plugin update
```

## Hosting your own marketplace

If you want your org to control which SOMI version teams get, fork SOMI or wrap it in your own
marketplace repo:

```
your-marketplace/
└── .claude-plugin/
    └── marketplace.json
```

Where `marketplace.json` lists SOMI (or your fork) as a plugin:

```json
{
  "name": "your-org-claude-tools",
  "description": "Internal Claude Code plugins for your-org.",
  "owner": { "name": "your-org", "url": "https://your-org.example.com" },
  "plugins": [
    {
      "name": "somi-ai",
      "source": "github:your-org/somi-ai",
      "version": "0.1.0",
      "description": "Plan / code / review workflow system.",
      "tags": ["workflow", "review", "security"]
    },
    {
      "name": "your-org-conventions",
      "source": "./plugins/your-org-conventions",
      "version": "1.0.0",
      "description": "your-org specific Claude conventions (HTTP errors, logging vocabulary, repo layout)."
    }
  ]
}
```

Teams then run:

```text
/plugin marketplace add https://github.com/your-org/your-marketplace
/plugin install somi-ai@your-org-claude-tools
/plugin install your-org-conventions@your-org-claude-tools
```

The two plugins compose at runtime — agents from one and skills from the other become available
together.

## Plugin vs. project install — when to use which

| Scenario                                                          | Recommended                                       |
|-------------------------------------------------------------------|---------------------------------------------------|
| Single repo; team owns it; they want exact reproducibility        | Project install (vendor under `.claude/`)         |
| Many repos; central updates; teams trust upstream                 | Plugin via marketplace (org or upstream SOMI)     |
| Personal default across all projects                              | User install                                      |
| Highly regulated; every change to tooling must be auditable in PR | Project install (vendored; tooling change is a diff) |
| Org with custom conventions on top of SOMI                        | Your own marketplace with SOMI + a conventions plugin |

## Plugin updates

```text
/plugin list                # shows installed plugins and versions
/plugin update              # update all
/plugin update somi-ai
/plugin pin somi-ai 0.1.0
/plugin unpin somi-ai
```

Pinning is recommended in production: teams adopt new versions deliberately, not whenever the
marketplace happens to publish.

## What a plugin install *doesn't* do

- It does **not** write a `CLAUDE.md` at your project root. The plugin's `CLAUDE.md` is loaded as
  context but doesn't replace your project's own.
- It does **not** create `PLAN.md` / `REVIEW.md` — those are artifacts created by the workflows when
  you actually run them.
- It does **not** modify your `settings.json`. SOMI hooks are wired through the plugin's own settings.

## Verifying a plugin install

After `/plugin install somi-ai@...`:

- `/plan`, `/code`, `/review` should appear in `/` autocomplete.
- `/agents` should list the SOMI agents.
- Try `/plan list a trivial change` — Claude should produce a plan.

If something's missing, check the plugin's load with `/plugin info somi-ai`. The plugin's
hooks should be visible in `/hooks` or equivalent debug output (depending on the Claude Code version).

## Building your own plugin on top

The pattern for an org-specific plugin (e.g., `your-org-conventions`):

1. New repo with the plugin shape (`.claude-plugin/plugin.json` + agents/commands/skills/hooks).
2. Compose with SOMI — your skills can link to SOMI skills, your agents can call SOMI agents.
3. List both in your marketplace.

Don't fork SOMI for org conventions; **compose** SOMI with a sibling plugin. Forks rot. Composition
survives upgrades.
