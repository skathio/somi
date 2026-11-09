# Migrating from 4.1 to 5.0

5.0 is a breaking rebuild. The `4.x` branch stays available for at least one minor cycle. Remove a 4.x install before you install 5.0: if both load, both sets of hooks and skills run, and its old instructions call tools that no longer exist.

## Commands

The 4.x commands are gone. Ask for the work in the chat, in plain words or as a ticket, and SoMi's agent routes it to the matching workflow. Six commands remain, each prefixed so no host's own command hides it:

| 4.x | 5.0 |
|---|---|
| `/code`, `/code-loop`, `/task`, `/debug`, `/refactor`, `/refactor-design`, `/upgrade`, `/incident` | Say it in the chat, or `/somi <it>` from another agent |
| `/plan`, `/plan-loop`, `/ship-loop`, `/code-parallel`, `/discover`, `/design`, `/atlas`, `/adopt`, `/impact` | Say it in the chat; large work offers `/somi-deliver` |
| `/review`, `/review-panel`, `/architecture-review`, `/test-strategy`, `/security-review` | `/somi-review`, or ask for a security review in the chat |
| `/ship`, `/pr`, `/release-readiness` | Ask for the pull request text in the chat |
| `/somi-config` | `/somi-config`, which also checks the setup |
| none | `/somi-quality`, the quality gate, and `/somi-status` |

## Agents

The agents are `somi`, three workers named for their tier (`somi-worker-low`, `-medium`, `-high`), `somi-reviewer` and `somi-security-reviewer`. The other 4.x specialists are now role text that `somi_route` returns. Ask `/somi-config` to run the conversation on a tier's model and start with `--agent somi-main`, or make `somi:somi` the active agent to route plain prompts.

## Skills

Expertise is loaded by workflows when needed, or through `somi-expertise`. `clean-code`, `solid-principles`, `reasoning-craft` and the general `observability` skill are gone, because the evidence shows they add nothing a current model lacks. API design, requirements and process guidance moved into role briefs and review lenses.

## State

Existing `.somi/plans/*` and `.somi/reviews/*` folders are no longer read or written. Import what is still open once, by asking the agent to run `somi migrate` for you. It copies open findings to a record of their own and recorded decisions to the ledger, and changes no old file. `/somi-status` then shows them.

## Config

Per-agent `cost.*` settings no longer apply. Tiers are set per host, and `ceiling` caps them:

```json
{ "tiers": { "claude": { "low": "haiku", "medium": "sonnet", "high": "opus" }, "ceiling": "high" } }
```

Copilot has no default map, so set yours if you want tiers enforced there. The old `sizing.sensitive_paths` and `sizing.module_containers` keys are now `signals.sensitive_paths` and `signals.module_containers`. `.somi/rules/99-overrides.md` is no longer read: put project rules in your `CLAUDE.md` or `AGENTS.md`.

## Tests and gates

Copy your test commands into a committed `somi.check.json`. See [the architecture document](ARCHITECTURE.md#gates).

## MCP

There are six tools: `somi_route`, `somi_review`, `somi_quality`, `somi_note`, `somi_plan` and `somi_pr`. `somi_command`, `somi_skill`, `somi_agent`, `somi_agent_info`, `somi_resolve`, `somi_config`, `somi_tier` and `somi_loop` are gone.

## Hooks

Rules arrive at session start and after compaction, not on every prompt. The dangerous-shell, dependency-install, secret-write, protected-path and audit hooks stay. New hooks apply tiers to subagents, keep reviewers read-only, ask before a change to the tier models or the quality limits, keep the user's own words for routing and briefs, and, when a turn that changed code ends, run the quality gate and say whether a review is due.
