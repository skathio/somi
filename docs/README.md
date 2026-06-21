# SoMi documentation

Start here if you're new. Skim the headings, then read what matches your situation.

## I want to…

| Want to…                                            | Read                                     |
|-----------------------------------------------------|------------------------------------------|
| Install SoMi into my project                        | [INSTALL.md](./INSTALL.md)               |
| Understand the workflows (discovery + plan/code/review) | [WORKFLOWS.md](./WORKFLOWS.md)          |
| Start a new product idea (research + requirements)  | [USAGE.md](./USAGE.md#discover)          |
| Actually run `/discover`, `/plan`, `/code`, `/review` | [USAGE.md](./USAGE.md)                  |
| Learn what each agent does and when it kicks in    | [AGENTS.md](./AGENTS.md)                 |
| Understand the hook guardrails                      | [HOOKS.md](./HOOKS.md)                   |
| Browse / extend skills                              | [SKILLS.md](./SKILLS.md)                 |
| Read the global rules philosophy                    | [RULES.md](./RULES.md)                   |
| See the slash command reference                     | [COMMANDS.md](./COMMANDS.md)             |
| Add a new workflow, agent, or skill                 | [EXTENDING.md](./EXTENDING.md)           |
| Understand the SemVer policy                        | [VERSIONING.md](./VERSIONING.md)         |
| Adopt SoMi in a team safely                         | [GOVERNANCE.md](./GOVERNANCE.md)         |
| Distribute via Claude Code's plugin marketplace     | [PLUGIN.md](./PLUGIN.md)                 |
| See how everything fits together                    | [architecture.md](./architecture.md)     |

## Conventions in these docs

- **"SoMi"** — the product; **"SoMi"** — the short form used in prose.
- **"agent"** = a specialised subagent under `agents/` invoked via the Task tool.
- **"command"** = a `/slash-command` under `commands/`.
- **"skill"** = an on-demand expert pack under `skills/`.
- **"hook"** = a deterministic guardrail script under `hooks/`.
- **"rule"** = a paragraph or section in `rules/` that the model follows.
- **"workflow"** = one of {discovery, planning, coding, reviewing} — the user-facing flows. Discovery is the upstream, greenfield-only one; planning/coding/reviewing are the daily build trio.
- **"artifact"** = a durable file produced by a workflow, stored under `.somi/rd/<slug>/` (discovery: `srs.md`, `sdd.md`, …) or `.somi/plans/<slug>/` (`spec.md`, `decisions.md`, `progress.md`, phase files) or `.somi/reviews/<slug>/`.
- **"work item"** = one `/plan` invocation's worth of artifacts, living in its own `.somi/plans/<slug>/` directory.
- **"initiative"** = one `/discover` invocation's worth of artifacts (the R&D foundation), living in its own `.somi/rd/<slug>/` directory.

## Top-level repo map

```
.claude-plugin/   Plugin + marketplace manifests
agents/           Subagent definitions
commands/         Slash-command entrypoints
skills/           On-demand expert knowledge
rules/            Global ruleset composed into CLAUDE.md
hooks/            Deterministic guardrails
templates/        Artifact templates
.copilot-extension/ Copilot extension manifest; marketplace manifest for copilot plugin install
examples/         Worked examples + sample consumer
docs/             You are here
```
