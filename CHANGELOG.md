# Changelog

All notable changes to `somi-ai` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-05-20

### Added
- Initial public release.
- Three workflows: planning (`/plan`), coding (`/code`), reviewing (`/review`), plus full pipeline (`/ship`).
- Subagents: `planner`, `coder`, `reviewer`, `security-reviewer`, `architecture-reviewer`, `test-strategist`, `refactorer`.
- Global ruleset (rules/) composing priorities, SOLID, clean code, OWASP defenses, engineering practices, collaboration.
- Skills: OWASP defense, SOLID principles, clean code, test strategy, API design, observability, threat modeling.
- Deterministic guardrail hooks: block dangerous bash, block secret writes, guard protected paths, lint changed files, audit log.
- Slash commands: `/plan`, `/code`, `/review`, `/ship`, `/plan-review`, `/security-review`, `/refactor`.
- Artifact templates: `PLAN.md`, `ITERATION.md`, `ADR.md`, `REVIEW.md`, `DOD.md`.
- Install profiles: `minimal`, `standard`, `full`.
- Installer (`scripts/install.sh`) supporting project / user / plugin scopes.
- Validator (`scripts/validate.sh`) for all agent / skill / hook / command files.
- Plugin manifest (`.claude-plugin/plugin.json`) and self-hosted marketplace manifest.
- Worked examples and a sample consuming project.
- Documentation set: install, usage, workflows, agents, hooks, skills, rules, commands, extending, versioning, governance, plugin, architecture.

[Unreleased]: https://github.com/your-org/somi-ai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/somi-ai/releases/tag/v0.1.0
