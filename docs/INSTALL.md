# Installation

SOMI supports **three install scopes** and **three install profiles**. Pick one of each.

## Scopes

| Scope     | Lives at                                                | Effect                                                              | Pick when                                                                  |
|-----------|---------------------------------------------------------|---------------------------------------------------------------------|----------------------------------------------------------------------------|
| `project` | `<repo>/.claude/`, `<repo>/CLAUDE.md`                  | Only this project gets SOMI                                         | You want a single repo to opt in; you want per-repo overrides              |
| `user`    | `~/.claude/`                                            | Every project you open in Claude Code inherits SOMI                 | You want SOMI as a personal default across all your projects               |
| `plugin`  | `<repo>/.claude/plugins/somi-ai/`               | Installed as a Claude Code plugin, manageable via `/plugin`         | You want versioned, marketplace-style distribution                         |

The `plugin` scope is also what the **marketplace** form of distribution uses under the hood — adding
SOMI via `/plugin marketplace add <repo>` and then `/plugin install somi-ai@...` is functionally
the same layout, just managed by Claude Code's plugin runtime instead of the install script.

## Profiles

| Profile     | What you get                                                                            | Pick when                                              |
|-------------|------------------------------------------------------------------------------------------|--------------------------------------------------------|
| `minimal`   | Rules + 3 core agents + 3 core commands + settings                                       | Tiny footprint; you'll add pieces as needed            |
| `standard`  | Rules + 3 core + 2 support agents + skills + hooks + templates                           | **Recommended** for most teams                          |
| `full`      | Everything in the repo                                                                   | You want the kitchen sink and will trim later          |

See [`install/profiles/`](../install/profiles/) for the exact component list per profile.

## Prerequisites

- `bash` 4+, `jq`, `git` (for plugin / update workflows).
- Claude Code (or compatible IDE extension) recent enough to support agents, skills, commands, and hooks.
- For lint hooks to do anything: whatever linter your project uses (`ruff`, `eslint`, `go vet`, etc.).
  Missing linters are silently skipped.

## Project install

```bash
# 1. Clone SOMI somewhere stable
git clone https://github.com/your-org/somi-ai.git /opt/somi-ai

# 2. From your project root:
/opt/somi-ai/scripts/install.sh \
  --scope project \
  --profile standard \
  --target "$PWD"
```

Result: `CLAUDE.md` at your project root, `.claude/` with agents/commands/skills/etc, hook scripts
under `.claude/plugins/somi-ai/hooks/`. Open the project in Claude Code (or reload).

## User install

```bash
git clone https://github.com/your-org/somi-ai.git ~/.somi-ai
~/.somi-ai/scripts/install.sh --scope user --profile standard
```

Result: same layout under `~/.claude/`. Every project you open inherits SOMI. Project-local
`CLAUDE.md` and `.claude/settings.json` still override.

## Plugin install (Claude Code marketplace)

```text
# Inside Claude Code:
/plugin marketplace add https://github.com/your-org/somi-ai
/plugin install somi-ai@somi-ai
```

This pulls the plugin payload directly into Claude Code's plugin store. No local clone needed. Updates
flow through `/plugin update`.

If you're hosting the marketplace yourself, see [PLUGIN.md](./PLUGIN.md) for the marketplace manifest
shape.

## Verifying the install

After install, run:

```bash
~/path/to/somi-ai/scripts/validate.sh
```

It checks frontmatter, JSON validity, hook scripts, settings wiring, and profile consistency. Used
by CI to gate PRs to SOMI itself.

In Claude Code, type `/` and you should see `/plan`, `/code`, `/review`, `/ship`, etc.

## Merge behavior on existing settings

If `.claude/settings.json` already exists, the installer **merges** rather than overwrites:

- `permissions.allow` / `permissions.deny`: union (deduplicated).
- `hooks`: events you already had keep their hooks; SOMI hooks are appended.
- `env`: existing keys preserved; SOMI keys added.
- Anything else: existing settings win.

Pass `--force` to overwrite unconditionally. **Read the diff before doing this** — `--force` is the
"I know what I'm doing" flag.

## Updating

```bash
~/path/to/somi-ai/scripts/update.sh --target "$PWD"
```

Or for plugin scope: `/plugin update somi-ai` in Claude Code.

`update.sh` reads `.somi/install.json` for the scope/profile, fetches the latest tag, and re-runs
install in place.

## Uninstall

```bash
~/path/to/somi-ai/scripts/uninstall.sh --target "$PWD"
```

Removes SOMI-managed paths. Preserves your artifacts (`PLAN.md`, `REVIEW.md`, `audit.log`).

## Troubleshooting

- **Hooks don't fire**: check `${SOMI_ROOT}` resolves correctly — it's set in `settings.json.env` and
  must point at the directory containing `hooks/`.
- **`jq` not found**: install it; the installer requires it for JSON merging.
- **Hook scripts not executable after install**: `cp -a` should preserve the mode; if not, run
  `chmod +x .claude/plugins/somi-ai/hooks/**/*.sh`.
- **`/plan` not visible**: reload the Claude Code window. Commands are loaded at session start.

See also: [HOOKS.md](./HOOKS.md), [USAGE.md](./USAGE.md), [PLUGIN.md](./PLUGIN.md).
