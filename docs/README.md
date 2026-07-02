# SoMi documentation

Start here if you're new. Skim the headings, then read what matches your situation.

## I want to…

| Want to…                                            | Read                                     |
|-----------------------------------------------------|------------------------------------------|
| Install SoMi into my project                        | [INSTALL.md](./INSTALL.md)               |
| Onboard SoMi into an **existing** codebase          | [USAGE.md](./USAGE.md#adopt) (`/adopt`)  |
| Understand the workflows (discovery + plan/code/review) | [WORKFLOWS.md](./WORKFLOWS.md)          |
| Start a new product idea (research + requirements)  | [USAGE.md](./USAGE.md#discover)          |
| Actually run `/discover`, `/plan`, `/code`, `/review` | [USAGE.md](./USAGE.md)                  |
| Debug a bug whose cause isn't isolated              | [USAGE.md](./USAGE.md#debug) (`/debug`)  |
| See what's in flight / get routed to the right command | [USAGE.md](./USAGE.md#somi) (`/somi`) |
| Configure loop caps & hook policy per project       | [USAGE.md](./USAGE.md#project-configuration-somiconfigjson) |
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
- **"workflow"** = a user-facing flow. The daily build trio is planning/coding/reviewing; discovery is the upstream, greenfield-only one; around them sit debugging (`/debug`), the lifecycle flows (`/upgrade`, `/release-readiness`, `/incident`), and the repo-level utilities (`/atlas`, `/impact`, `/adopt`, `/somi`, `/pr`).
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
scripts/          Runtime tooling (somi-loop, somi-findings, somi-check) + validate.sh
templates/        Artifact templates
tests/            Hook fixtures + script end-to-end tests (run by validate.sh / CI)
.copilot-extension/ Copilot extension manifest; marketplace manifest for copilot plugin install
examples/         Worked examples + sample consumer
docs/             You are here
```
