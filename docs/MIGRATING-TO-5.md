# Migrating from 4.1 to 5.0

5.0 is a breaking rebuild. The `4.x` branch stays available for at least one minor cycle.

## Commands

| 4.x | 5.0 |
|---|---|
| `/code`, `/code-loop`, `/ship-loop`, `/debug`, `/refactor`, `/incident`, `/upgrade` | `/task` |
| `/plan`, `/plan-loop`, `/design`, `/discover`, `/refactor-design` | `/plan`, opt-in, one file |
| `/review`, `/review-panel`, `/security-review`, `/architecture-review` | `/review` |
| `/ship`, `/pr`, `/release-readiness` | `/ship` |
| `/atlas`, `/adopt`, `/impact`, `/test-strategy`, `/code-parallel`, `/somi-config` | Removed |

## Agents

The agents are now `somi-coder`, `somi-reviewer` and `somi-security-reviewer`. The `somi` front door and its `somi-flow` and `somi-general` runners are gone, so `@somi` routing on Copilot no longer exists. Use `/task`, or just ask.

## State

Existing `.somi/plans/*` and `.somi/reviews/*` folders are no longer read or written. Import what is still open once:

```bash
somi migrate
```

It copies open findings and recorded decisions into the journal and changes no old file. `somi status` then shows them.

## Config

Per-agent `cost.*` settings no longer apply. There are two tiers, set per host:

```json
{ "tiers": { "claude": { "work": "sonnet", "review": "opus" } } }
```

The old `sizing.sensitive_paths` and `sizing.module_containers` keys are now `signals.sensitive_paths` and `signals.module_containers`. `.somi/rules/99-overrides.md` is no longer read: put project rules in your `CLAUDE.md` or `AGENTS.md`, which each host loads itself.

## Tests and gates

Copy your test commands into a committed `somi.check.json`. See [the architecture document](ARCHITECTURE.md#gates).

## MCP

There is one tool now, `somi_step`. `somi_command`, `somi_skill`, `somi_agent`, `somi_agent_info`, `somi_resolve`, `somi_config`, `somi_tier` and `somi_loop` are gone.

## Hooks

Rules arrive once at session start, not on every prompt. The hooks for cost lowering, lint on write, default config and repo-instruction detection are gone. The dangerous-shell, dependency-install, secret-write, protected-path and audit hooks stay.

## Copilot CLI

The plugin brings the hooks. `somi init --host copilot` writes `.github/hooks/somi.json` for a repository that wants them without the plugin.
