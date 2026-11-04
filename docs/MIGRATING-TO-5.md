# Migrating from 4.1 to 5.0

5.0 is a breaking rebuild. The `4.x` branch stays available for at least one minor cycle.

## Commands

Every 4.x command name still works and routes to the matching workflow. `/somi` is the way in for anything else.

| 4.x | 5.0 |
|---|---|
| `/code`, `/code-loop`, `/task` | `/code` |
| `/ship-loop`, `/plan`, `/plan-loop`, `/code-parallel` | `/plan`: milestones with fresh context |
| `/refactor`, `/refactor-design` | `/refactor` |
| `/review`, `/review-panel`, `/architecture-review`, `/test-strategy` | `/review` |
| `/security-review` | `/security-review` |
| `/ship`, `/pr`, `/release-readiness` | `/ship` |
| `/atlas`, `/adopt`, `/impact` | Routed; old names still work |
| `/discover`, `/design` | Routed, and `/design` |
| `/debug`, `/upgrade`, `/incident`, `/somi-config` | Same names |

New: `/a11y-check`, plus `perf` and `migrate` workflows reached through `/somi`.

## Agents

The agents are `somi`, `somi-worker`, `somi-reviewer` and `somi-security-reviewer`. The other 4.x specialists are now role briefs the step engine gives to a worker. Make `somi:somi` the active agent to route plain prompts.

## Skills

Expertise is loaded by workflows when needed, or through `somi-expertise`. `clean-code`, `solid-principles`, `reasoning-craft` and the general `observability` skill are gone, because the evidence shows they add nothing a current model lacks. API design, requirements and process guidance moved into role briefs and review lenses.

## State

Existing `.somi/plans/*` and `.somi/reviews/*` folders are no longer read or written. Import what is still open once:

```bash
somi migrate
```

It copies open findings and recorded decisions into the journal and changes no old file. `somi status` then shows them.

## Config

Per-agent `cost.*` settings no longer apply. Tiers are set per host, and `ceiling` caps them:

```json
{ "tiers": { "claude": { "low": "haiku", "medium": "sonnet", "high": "opus" }, "ceiling": "high" } }
```

Copilot has no default map, so set yours if you want tiers enforced there. The old `sizing.sensitive_paths` and `sizing.module_containers` keys are now `signals.sensitive_paths` and `signals.module_containers`. `.somi/rules/99-overrides.md` is no longer read: put project rules in your `CLAUDE.md` or `AGENTS.md`.

## Tests and gates

Copy your test commands into a committed `somi.check.json`. See [the architecture document](ARCHITECTURE.md#gates).

## MCP

There is one tool, `somi_step`. `somi_command`, `somi_skill`, `somi_agent`, `somi_agent_info`, `somi_resolve`, `somi_config`, `somi_tier` and `somi_loop` are gone.

## Hooks

Rules arrive at session start and after compaction, not on every prompt. The dangerous-shell, dependency-install, secret-write, protected-path and audit hooks stay. New hooks apply tiers to subagents, keep edits with workers during a workflow on Claude Code, keep reviewers read-only, and ask before tier config changes.
