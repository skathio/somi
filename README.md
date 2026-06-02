# SoMi AI

> An opinionated, reusable multi-agent engineering workflow system for Claude Code and GitHub Copilot.

[![npm](https://img.shields.io/npm/v/@skathio/somi-ai?logo=npm)](https://www.npmjs.com/package/@skathio/somi-ai)

The latest published version is on [npm](https://www.npmjs.com/package/@skathio/somi-ai) and in the
[GitHub Releases](https://github.com/skathio/somi-ai/releases); see [CHANGELOG.md](CHANGELOG.md) for
release notes.

SoMi AI gives engineering teams a shared, version-controlled "operating system" for working with Claude:
three first-class build workflows — **plan → code → review** — plus an upstream **discovery** workflow
that turns a raw product idea into a research-grounded requirements & design foundation. All backed by
specialised subagents, deterministic guardrail hooks, composable skills, and a global ruleset that
enforces SOLID, clean code, and OWASP defenses.

It is designed to be:

- **Reusable** across many repositories and teams
- **Installable** as a Claude Code plugin (via marketplace or npm) or as a GitHub Copilot chat extension
- **Opinionated but extensible** — strong defaults, clean overrides
- **Deterministic where possible** (hooks) and **judgment-heavy where needed** (agents)

---

## The workflows

| Command       | Workflow            | Agent               | Purpose                                                                                  |
|---------------|---------------------|---------------------|------------------------------------------------------------------------------------------|
| `/discover`   | Discovery (pre-dev) | `discovery-analyst` | Research the competition, then author the requirements & design foundation (BRD/SRS/FRD/SDD/TDD) for a new product |
| `/plan`       | Planning            | `planner`           | Staff-engineer-grade plan: phases, risks, slices, DoD, test & rollout strategy           |
| `/code`       | Coding              | `coder`             | Execute against an approved plan with senior-level design judgment                       |
| `/review`     | Reviewing           | `reviewer`          | Strict, skeptical review of code / plans / architecture with severity-graded findings    |
| `/ship`       | Pipeline            | planner+coder+reviewer | Full plan → code → review pipeline against a single problem statement                  |

`/discover` is the upstream, greenfield-only step that feeds `/plan`; the plan → code → review trio is the
daily build loop. Supporting agents (used by handoff): `security-reviewer`, `architecture-reviewer`,
`test-strategist`, `refactorer`.

---

## Install

### Option 1 — Claude Code plugin (marketplace)

```text
# Add the SoMi AI marketplace and install the plugin:
/plugin marketplace add https://github.com/skathio/somi-ai
/plugin install somi-ai@somi-ai
```

Updates flow through `/plugin update somi-ai`.

### Option 2 — npm (Claude Code)

```bash
npm install -g @skathio/somi-ai
```

Then in Claude Code: `/plugin install somi-ai`.

### Option 3 — GitHub Copilot (extension marketplace)

SoMi AI is also a GitHub Copilot extension, installable the same way as the Claude Code plugin:

```text
copilot plugin marketplace add https://github.com/skathio/somi-ai
copilot plugin install somi-ai@somi-ai
```

Once installed, use `@somi-ai` in GitHub Copilot chat:

```text
@somi-ai /plan  Add per-team rate limiting to the public webhook endpoint
@somi-ai /code  rate-limiting-webhooks phase 1, iteration 1
@somi-ai /review  rate-limiting-webhooks
```

---

## What's in the box

```
.claude-plugin/   Plugin + marketplace manifests (Claude Code plugin distribution)
agents/           Subagent definitions (planner, coder, reviewer, + support)
commands/         Slash-command entrypoints (/plan, /code, /review, /ship, ...)
skills/           On-demand expert knowledge packs (OWASP, SOLID, test strategy, ...)
rules/            Global ruleset composed into CLAUDE.md
hooks/            Deterministic guardrails (block dangerous bash, secret writes, ...)
templates/        Artifact templates (CONTEXT, SPEC, DECISIONS, PHASE, PROGRESS, DIARY, REVIEW, ADR, DOD; R&D: RD-README, RESEARCH, BRD, SRS, FRD, SDD, TDD)
.copilot-extension/ Copilot extension + marketplace manifests (mirrors .claude-plugin/)
examples/         Worked examples + a minimal consuming project
docs/             Full documentation
```

When you use SoMi AI in a project, workflows write their artifacts into a `.somi/` directory
at the project root. Discovery foundations live under `.somi/rd/<slug>/` (research report, BRD, SRS,
FRD, SDD, TDD); plans live under `.somi/plans/<slug>/` (context, spec, decisions, progress, diary,
phases); reviews live under `.somi/reviews/<slug>/` — separate directories, no clutter.
See [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) for the full layout.

---

## Quick start (after install)

For a **brand-new product**, start one step earlier with discovery:

```text
> /discover  A self-hosted alternative to Calendly for clinics, with HIPAA-aware
            scheduling, SMS reminders, and no per-seat pricing.

# Claude proposes a slug ("clinic-scheduler"), researches competitors and real user
# complaints (cited), pauses on each crossroads (persona, scope, build-vs-integrate,
# expensive-to-reverse architecture), and writes a traceable requirements & design set
# to .somi/rd/clinic-scheduler/ (research report, BRD, SRS, FRD, SDD, TDD). Then run
# /plan clinic-scheduler — the planner consumes that foundation.
```

For an **incremental change** (the daily loop), start at planning:

```text
> /plan  Add per-team rate limiting to the public webhook ingestion endpoint
        with audit logging and an emergency kill switch.

# Claude proposes a slug ("rate-limiting-webhooks"), reads the repo, drafts context.md,
# then pauses inline on each architectural decision — presenting options with concrete
# pros/cons, plus "Other" and "Discover" escape hatches. You decide. Verified decisions
# land in decisions.md; the spec, phases, progress, and diary fill in. Review the
# artifacts at .somi/plans/rate-limiting-webhooks/, edit if needed, approve.

> /code  rate-limiting-webhooks phase 1, iteration 1

# Claude implements with senior-engineer judgment, writes tests, updates docs, and
# keeps the plan in sync — if implementation reveals the plan needs to change, it
# updates spec/decisions/phases in place and appends a diary entry.

> /review  rate-limiting-webhooks

# Claude returns severity-graded findings (written under reviews/), rejects weak
# solutions, flags plan-vs-code divergence.
```

For the all-in-one pipeline: `/ship <problem statement>`.

---

## Why a shared OS, not per-project setups

- **Consistency** — every repo gets the same review bar, the same security posture, the same plan shape.
- **Upgrade once** — update the plugin; every project benefits.
- **Override locally** — projects keep their own `CLAUDE.md` and `rules/99-overrides.md`; SoMi AI never silently overrides them.
- **Auditable** — hooks log denied actions; reviewers can see what the system blocked vs. what humans approved.

---

## Documentation

- [Installation](docs/INSTALL.md) — Claude Code plugin, npm, or Copilot extension
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
- [Plugin distribution](docs/PLUGIN.md) — marketplace and VS Code setup
- [Architecture](docs/architecture.md) — how the pieces fit together

---

## Versioning

SoMi AI follows [Semantic Versioning](https://semver.org/). Releases are **automated from
[Conventional Commits](https://www.conventionalcommits.org/)**: merging to `main` runs the publish
workflow, which derives the next version, publishes to npm (with a signed provenance attestation via
OIDC trusted publishing), pushes the `v<version>` git tag, and creates the matching GitHub Release.

The **published git tags and the npm registry are the source of truth** for the released version —
the in-repo `VERSION` / `package.json` are not committed back on each release, so don't rely on them
for "what's published." Check the [npm page](https://www.npmjs.com/package/@skathio/somi-ai) or
[Releases](https://github.com/skathio/somi-ai/releases) instead.

See [docs/VERSIONING.md](docs/VERSIONING.md) for the breaking-change policy and migration guide template.

---

## License

MIT — see [LICENSE](LICENSE).
