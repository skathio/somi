# Changelog

All notable changes to `@skathio/somi-ai` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — versioning: [SemVer](https://semver.org/).

## [Unreleased] — Audit-driven overhaul

### Fixed (bugs)

- **Hooks now load on a clean marketplace install.** Added `hooks/hooks.json` so Claude Code
  auto-merges the plugin's hooks using `${CLAUDE_PLUGIN_ROOT}`. The previous wiring (vendored
  `SOMI_ROOT`) only worked for hand-copy installs. The reference vendored configuration in
  `.claude/settings.json` now uses `${SOMI_VENDOR_ROOT}` to make the distinction explicit.
- **Hook output schema migrated to `hookSpecificOutput`.** `PreToolUse` denies use
  `hookSpecificOutput.permissionDecision="deny"`; `PostToolUse` and `UserPromptSubmit` context
  uses `hookSpecificOutput.additionalContext`. The old bare `{decision:"block"}` /
  `{additionalContext:…}` shapes were silently dropped by the harness — lint feedback, per-turn
  reminders, and handoff nudges were going to `/dev/null`.
- **Destructive-SQL patterns are now case-insensitive** (catches `drop database`, `truncate
  table`, etc. from lowercase tooling output).
- **`git push --force-with-lease` to protected branches is now denied**, including the refspec
  form (`origin HEAD:main`). Previously slipped through.
- **`enforce-handoff` Stop hook removed** — Stop events have no `additionalContext` channel, so
  the nudge was dead. The TODO(claude)/scratch-file detection moved to
  `inject-workflow-context` (UserPromptSubmit, which does support the channel).
- **Stale `PLAN.md` / `REVIEW.md` detection removed** — the workflow moved to `.somi/plans/<slug>/`
  long ago; the old detector never fired.

### Added

- **`gate-dep-install.sh` PreToolUse hook** — denies `npm install <pkg>`, `pip install <pkg>`,
  `cargo add`, etc. without `SOMI_ALLOW_DEP_INSTALL=1`. Adding a runtime dep crosses a trust
  boundary; the agent shouldn't drive-by it. Bare lockfile-respecting reinstalls are allowed.
- **`/code-loop`** — bounded code → review → fix loop on one iteration. Hard gates:
  `MAX_PASSES`, `SEVERITY_FLOOR`, `DIFF_CAP_LINES`, circuit breaker on recurring findings.
  Replaces `/ship`'s formerly-unbounded inner loop.
- **`/plan-loop`** — bounded plan → review → revise loop for ambiguous/architectural work. Hard
  gates: `MAX_PASSES`, divergence detector.
- **`/ship-loop`** — bounded composition of `/plan-loop` → [hard human gate] → `/code-loop` per
  iteration. The human gate between plan-done and code-start is **non-overridable**.
- **`/architecture-review`** — entry point for the `architecture-reviewer` agent (previously had
  no command entry).
- **`/test-strategy`** — entry point for the `test-strategist` agent (previously had no command
  entry).

### Changed

- **`/ship`** is now bounded by construction — Stage 2 delegates to `/code-loop`, inheriting its
  caps. Hard human gates between stages preserved.
- **`/review` absorbs `/plan-review`.** Use `/review plan <slug>` for plan-level review (or pass
  an `.somi/plans/` path). `/plan-review` command file deleted.
- **`/review` auto-invokes consultants** via Task based on a trigger table
  (security-reviewer / architecture-reviewer / test-strategist). Previously consultants were
  only mentioned in prose hints and could be silently skipped.
- **`reviewer` agent dropped Write/Edit tools.** Now read-only (Read/Grep/Glob/Bash), matching
  `security-reviewer`'s permission model. Commands own all writes to plan/review artifacts.
- **All orchestration commands run on `sonnet`** (plan/code/refactor/review/security-review,
  plus the new loop commands). Agents stay on `opus`. The opus tier no longer runs the thin
  router layer.
- **User input fenced as data** in `/plan`, `/code`, and the new loop commands; persisted under
  `context.md §1` (single source) and the work-item-started diary entry as
  ` ```user-problem-statement … ``` `. Prevents prompt injection from external problem
  statements (issues, PRs, teammate quotes) being treated as instructions by downstream agents.
- **Skills explicitly reference rules** instead of restating them. The rule is the always-on
  floor; skills add operational depth (examples, decision tables, anti-patterns) only.
- **Iteration status lives only in `progress.md`** — the `phases/<NN>.md` template no longer
  carries `Status:` fields. Single source of truth; no drift.
- **Verbatim user problem statement lives only in `context.md §1`** — `spec.md §1` is the
  agent's restatement; `diary.md` Work-item-started entry points back. No more
  three-place duplication.
- **`inject-workflow-context.sh`** now scopes the reminder block to first turn / state-change
  (signature based on `.somi/plans/**/progress.md` and `.somi/reviews/**/*.md` mtimes). Avoids
  double-loading the always-on rules content on every user turn.

### Internal

- `hooks/lib/common.sh` rewritten: `somi::deny_pretool` and `somi::context` helpers replace
  the old `somi::block` (which emitted the wrong schema for `PreToolUse`).
- `permissions.deny` in `.claude/settings.json` extended to cover `--force-with-lease`.
- Added `.claude/somi-state/` to `.gitignore` (state for the context-injection signature check).

---

## [0.1.0] — 2026-05-21 — Initial release

First public release of SoMi AI.

### Added

#### Workflows and commands

- Three first-class workflows: **planning** (`/plan`), **coding** (`/code`), **reviewing** (`/review`), plus the full end-to-end pipeline (`/ship`).
- Supporting commands: `/plan-review`, `/security-review`, `/refactor`.
- Human-in-the-loop gates: every stage stops for explicit user approval before proceeding.

#### Agents

- **Core**: `planner`, `coder`, `reviewer`.
- **Support**: `security-reviewer`, `architecture-reviewer`, `test-strategist`, `refactorer`.

#### Planning — user-verified decisions

- The planner pauses inline on every architectural or design decision, presenting 2–4 concrete
  options with specific pros and cons (no vague phrasings), a recommendation, and two escape
  hatches: **Other** (user proposes a custom option) and **Discover** (guided narrowing questions
  to help the user choose by asking what favors or disadvantages each option).

#### Artifact model — `.somi/` directory

Every `/plan` invocation creates a work-item directory under `.somi/plans/<slug>/` containing:

- `context.md` — background, surrounding code, dependencies, constraints.
- `spec.md` — purpose, user story, requirements, core decision one-liners, DoD.
- `decisions.md` — ADR-style log: options, pros/cons, recommendation, discovery Q&A, reversibility. Decisions are never edited in place; stale ones are superseded by new entries.
- `progress.md` — single source of truth for status; phase table; in-flight work; open decisions.
- `diary.md` — append-only chronological narrative (newest first): plan changes, blockers, discoveries, review feedback.
- `phases/<NN>-*.md` — one file per phase, with iterations, acceptance criteria, test and observability changes, rollback steps.

Reviews are stored separately under `.somi/reviews/<slug>/`, one file per `/review` run.

#### Plan-change protocol

When implementation reveals the plan needs to change, the coder: updates `spec.md`, `decisions.md` (supersede, never edit), and `phases/` in place; appends a `diary.md` entry recording what changed and why; surfaces the change to the user before continuing. The plan never shows stale state.

#### Artifact templates

`CONTEXT.md.tmpl`, `SPEC.md.tmpl`, `DECISIONS.md.tmpl`, `PHASE.md.tmpl`, `PROGRESS.md.tmpl`,
`DIARY.md.tmpl`, `SOMI-README.md.tmpl`, `REVIEW.md.tmpl`, `ADR.md.tmpl`, `DOD.md.tmpl`.

#### Ruleset and skills

- Global ruleset (`rules/`) composing: priorities, SOLID, clean code, OWASP defenses, engineering practices, collaboration norms (including the user-verification protocol).
- On-demand skills: OWASP defense, SOLID principles, clean code, test strategy, API design, observability, threat modeling.

#### Deterministic guardrail hooks

Block dangerous shell commands, block secret writes, guard protected paths, lint changed files,
audit-log every tool call.

#### Distribution

- Claude Code plugin: marketplace manifest (`.claude-plugin/`) and npm package (`@skathio/somi-ai`).
- GitHub Copilot extension: `.copilot-extension/` manifest mirrors the Claude Code plugin.
- Validator workflow (`.github/workflows/validate.yml`): JSON, shellcheck, frontmatter checks.
- Release workflow (`.github/workflows/release.yml`).

#### Documentation and examples

Full documentation set: install, usage, workflows, agents, hooks, skills, rules, commands,
extending, versioning, governance, plugin, architecture.

Worked examples: feature plan (full six-artifact walkthrough), code review, end-to-end pipeline
transcript, and a sample consuming project showing the post-install layout.

[0.1.0]: https://github.com/skathio/somi-ai/releases/tag/v0.1.0
