# somi-ai documentation

Start here if you're new. Skim the headings, then read what matches your situation.

## I want to…

| Want to…                                            | Read                                     |
|-----------------------------------------------------|------------------------------------------|
| Install SOMI into my project                        | [INSTALL.md](./INSTALL.md)               |
| Understand the three workflows                      | [WORKFLOWS.md](./WORKFLOWS.md)           |
| Actually run `/plan`, `/code`, `/review`            | [USAGE.md](./USAGE.md)                   |
| Learn what each agent does and when it kicks in    | [AGENTS.md](./AGENTS.md)                 |
| Understand the hook guardrails                      | [HOOKS.md](./HOOKS.md)                   |
| Browse / extend skills                              | [SKILLS.md](./SKILLS.md)                 |
| Read the global rules philosophy                    | [RULES.md](./RULES.md)                   |
| See the slash command reference                     | [COMMANDS.md](./COMMANDS.md)             |
| Add a new workflow, agent, or skill                 | [EXTENDING.md](./EXTENDING.md)           |
| Understand the SemVer policy                        | [VERSIONING.md](./VERSIONING.md)         |
| Adopt SOMI in a team safely                         | [GOVERNANCE.md](./GOVERNANCE.md)         |
| Distribute via Claude Code's plugin marketplace     | [PLUGIN.md](./PLUGIN.md)                 |
| See how everything fits together                    | [architecture.md](./architecture.md)     |

## Conventions in these docs

- **"SOMI"** = somi-ai.
- **"agent"** = a specialised subagent under `agents/` invoked via the Task tool.
- **"command"** = a `/slash-command` under `commands/`.
- **"skill"** = an on-demand expert pack under `skills/`.
- **"hook"** = a deterministic guardrail script under `hooks/`.
- **"rule"** = a paragraph or section in `rules/` that the model follows.
- **"workflow"** = one of {planning, coding, reviewing} — the three first-class user-facing flows.
- **"artifact"** = a durable file produced by a workflow (`PLAN.md`, `REVIEW.md`, ADR, etc.).

## Top-level repo map

```
.claude-plugin/   Plugin + marketplace manifests
agents/           Subagent definitions
commands/         Slash-command entrypoints
skills/           On-demand expert knowledge
rules/            Global ruleset composed into CLAUDE.md
hooks/            Deterministic guardrails
templates/        Artifact templates
install/          Install profiles + manifest
scripts/          install / validate / update / uninstall
examples/         Worked examples + sample consumer
docs/             You are here
```
