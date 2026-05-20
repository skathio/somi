# somi-ai

> An opinionated, reusable multi-agent engineering workflow system for Claude Code and Claude-compatible IDE extensions.

`somi-ai` (SOMI) gives engineering teams a shared, version-controlled "operating system" for working with Claude:
three first-class workflows — **plan → code → review** — backed by specialised subagents, deterministic guardrail hooks,
composable skills, and a global ruleset that enforces SOLID, clean code, and OWASP defenses.

It is designed to be:

- **Reusable** across many repositories and teams
- **Installable** at three scopes: project, user, or as a Claude Code **plugin** distributed via marketplace
- **Opinionated but extensible** — strong defaults, clean overrides
- **Deterministic where possible** (hooks) and **judgment-heavy where needed** (agents)
- **Distribution-first**: pull updates via git tags, versioned profiles, and an install manifest

---

## The three workflows

| Command       | Workflow  | Agent       | Purpose                                                                                  |
|---------------|-----------|-------------|------------------------------------------------------------------------------------------|
| `/plan`       | Planning  | `planner`   | Staff-engineer-grade plan: phases, risks, slices, DoD, test & rollout strategy           |
| `/code`       | Coding    | `coder`     | Execute against an approved plan with senior-level design judgment                       |
| `/review`     | Reviewing | `reviewer`  | Strict, skeptical review of code / plans / architecture with severity-graded findings    |
| `/ship`       | Pipeline  | all three   | Full plan → code → review pipeline against a single problem statement                    |

Supporting agents (used by handoff): `security-reviewer`, `architecture-reviewer`, `test-strategist`, `refactorer`.

---

## Install (three scopes)

### 1. Plugin (recommended — Claude Code marketplace)

```bash
# Inside Claude Code:
/plugin marketplace add https://github.com/skathio/somi-ai
/plugin install somi-ai@somi-ai
```

### 2. Project-local (vendored under `.claude/`)

```bash
git clone https://github.com/skathio/somi-ai.git /tmp/somi
/tmp/somi/scripts/install.sh --scope project --profile standard --target .
```

### 3. User-global (every project you open)

```bash
git clone https://github.com/skathio/somi-ai.git ~/.somi-ai
~/.somi-ai/scripts/install.sh --scope user --profile standard
```

Full installation matrix and trade-offs: [docs/INSTALL.md](docs/INSTALL.md).

---

## What's in the box

```
.claude-plugin/   Plugin + marketplace manifests (Claude Code plugin distribution)
agents/           Subagent definitions (planner, coder, reviewer, + support)
commands/         Slash-command entrypoints (/plan, /code, /review, /ship, ...)
skills/           On-demand expert knowledge packs (OWASP, SOLID, test strategy, ...)
rules/            Global ruleset composed into CLAUDE.md
hooks/            Deterministic guardrails (block dangerous bash, secret writes, ...)
templates/        Artifact templates (PLAN.md, ADR.md, REVIEW.md, DoD, ...)
install/          Install profiles (minimal / standard / full) and manifest
scripts/          install.sh, validate.sh, update.sh, uninstall.sh
examples/         Worked examples + a minimal consuming project
docs/             Full documentation
```

---

## Quick start (after install)

```text
> /plan  Add per-team rate limiting to the public webhook ingestion endpoint
        with audit logging and an emergency kill switch.

# Claude returns a structured PLAN.md (problem framing, phases, risks, DoD, ...)
# Review it, edit, approve.

> /code  Implement phase 1 of the plan in PLAN.md.

# Claude implements with senior-engineer judgment, writes tests, updates docs.

> /review  Review the diff against the plan and the global ruleset.

# Claude returns severity-graded findings, rejects weak solutions.
```

For the all-in-one pipeline: `/ship <problem statement>`.

---

## Why a shared OS, not per-project setups

- **Consistency** — every repo gets the same review bar, the same security posture, the same plan shape.
- **Upgrade once** — `scripts/update.sh` pulls a new tagged version; every project benefits.
- **Override locally** — projects keep their own `CLAUDE.md` and `rules/99-overrides.md`; SOMI never silently overrides them.
- **Auditable** — hooks log denied actions; reviewers can see what the system blocked vs. what humans approved.

---

## Documentation

- [Installation](docs/INSTALL.md) — scopes, profiles, plugin vs. vendored
- [Usage](docs/USAGE.md) — running each workflow with examples
- [Workflows](docs/WORKFLOWS.md) — plan / code / review semantics and handoffs
- [Agents](docs/AGENTS.md) — full agent catalogue, escalation rules
- [Hooks](docs/HOOKS.md) — guardrails and how to add your own
- [Skills](docs/SKILLS.md) — on-demand expertise packs
- [Rules](docs/RULES.md) — global ruleset philosophy and conflict resolution
- [Commands](docs/COMMANDS.md) — slash-command reference
- [Extending](docs/EXTENDING.md) — adding workflows, agents, skills
- [Versioning](docs/VERSIONING.md) — SemVer policy, breaking-change rules
- [Governance](docs/GOVERNANCE.md) — how teams adopt updates safely
- [Plugin distribution](docs/PLUGIN.md) — marketplace setup
- [Architecture](docs/architecture.md) — how the pieces fit together

---

## Versioning

SOMI follows [Semantic Versioning](https://semver.org/). The `VERSION` file is the source of truth.
See [docs/VERSIONING.md](docs/VERSIONING.md) for the breaking-change policy and migration guide template.

Current version: see [VERSION](VERSION).

---

## License

MIT — see [LICENSE](LICENSE).
