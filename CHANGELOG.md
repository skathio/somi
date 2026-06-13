# Changelog

All notable changes to `@skathio/somi-ai` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — versioning: [SemVer](https://semver.org/).

## [0.4.0] — 2026-06-13 — Critical thinking, parallel review & context discipline

A quality-focused release: agents now **challenge the premise** of a request instead of taking it as
truth, reviews can run as a **parallel multi-lens panel**, provably-independent iterations can be
built in **isolated worktrees and integrated sequentially**, and the generated artifacts + ruleset
are bounded so they **don't rot the context** as a work item ages. Plus three correctness fixes in
the loop machinery and the audit hook.

> **Pre-1.0 note:** one change adjusts how the ruleset is loaded (always-on digest + read-on-demand)
> rather than "read every numbered file before acting." Behavior is preserved on the common path; the
> numbered rule files remain authoritative and are pulled in when their domain is engaged. Flagged
> here per the pre-1.0 policy (MINOR may include behavior changes, documented).

### Added

- **`/review-panel` — parallel multi-lens review.** Seats the `reviewer` plus the
  `security-reviewer` / `architecture-reviewer` / `test-strategist` lenses **as the diff warrants**,
  runs them concurrently on the *same* captured diff, then **merges and de-duplicates** their findings
  (locus-based, not line-based) into one severity-graded verdict — highest severity wins, lens
  disagreement is surfaced, not averaged. Read-only lenses; the orchestrator owns all writes. Falls
  back to sequential where the host can't spawn concurrent sub-agents.
- **`/code-parallel` — independent iterations in parallel, integrated sequentially.** Fans the
  iterations the planner marked `Parallelizable` (with **provably disjoint file sets**) into isolated
  git worktrees, builds each under `/code-loop`, then **integrates one at a time behind a gate**
  (full test run + review per merge). A merge conflict is treated as a planning bug and handed back,
  never auto-resolved. Conservative by construction: parallel only where proven, sequential
  everywhere else, with a worktree/host fallback to plain `/code-loop`.
- **Premise-challenge step** in the `planner` (step 1a) and `discovery-analyst` (step 1a). Before
  generating options, agents now state the strongest honest case *against* the request — false
  premise, XY problem, contradictory requirements, already-solved need, or cost/value mismatch — and
  pause if it doesn't hold. Discovery gains an explicit **go / no-go / pivot** decision: a cited
  "don't build this" memo is now a valid, first-class outcome instead of manufactured paperwork.
- **`Parallelizable` field** on each iteration in `templates/PHASE.md.tmpl`, recording the
  disjoint-file-set contract that `/code-parallel` verifies before fanning out.
- **Always-on rules digest** in `rules/CLAUDE.md` — the compressed, always-in-force form of the
  numbered rule files, with a documented on-demand model for loading the full files.
- **`SOMI_CODE_LOOP_REVIEW=panel`** — run the parallel review panel inside `/code-loop` instead of
  the single reviewer.

### Changed

- **`reviewer` reads a bounded artifact set.** Live decisions (not the superseded appendix), the
  active phase file(s) (not every phase), and the recent diary slice (entries since the last review,
  or the last ~10) instead of the full accumulated history — caps review cost on long-lived work
  items where `diary.md` / `decisions.md` grow without bound.
- **`planner` parallelism marking is now a precise, consumed contract.** Step 6 sets each iteration's
  `Parallelizable` field to `yes — with <N>.K` only when file sets are provably disjoint and neither
  depends on the other; `/code-parallel` is the consumer. Previously the "parallelizable" hint was a
  loose note nothing acted on.
- **Ruleset loading: always-on digest + read-on-demand.** `rules/CLAUDE.md`'s "read every numbered
  file before acting" is replaced by an always-on digest plus "read the full numbered file when you
  enter its domain" (the model the skills already use) — reducing the fixed per-agent context tax of
  re-reading ~600 lines of rules on every sub-agent invocation. The numbered files stay authoritative.
- **`rules/50-collaboration.md`** gains a "challenge the premise, not just the architecture" rule:
  deference on *direction* is correct; deference on *whether the direction is sound* is not.
- **Artifact reading-discipline & compaction.** `templates/DECISIONS.md.tmpl` (live vs. superseded
  appendix — read live, skip the archive unless tracing a supersession) and `templates/DIARY.md.tmpl`
  (recent-slice reads + optional human compaction that never drops decision/plan-change entries) now
  document how to keep artifacts from bloating every reader's context as the work ages.
- **Specialist agents name their sibling skill as the single source of truth.** `security-reviewer`
  (→ `owasp-defense`, `threat-modeling`), `test-strategist` (→ `test-strategy`),
  `architecture-reviewer` (→ `solid-principles`, `api-design`), and `refactorer` (→ `solid-principles`,
  `clean-code`) now state that on a technique divergence the **skill wins** — preventing the guidance
  drift that comes from maintaining the same knowledge in two places.
- **Honest Copilot parity docs.** README, `docs/PLUGIN.md`, and `docs/HOOKS.md` now state plainly that
  the deterministic guardrail **hooks do not fire on Copilot** and that **multi-agent orchestration
  degrades to sequential** there. Copilot is the portable subset, not a drop-in equal.

### Fixed (bugs)

- **The audit hook could create a literal `${CLAUDE_PROJECT_DIR}` directory.** When a host didn't
  expand `${CLAUDE_PROJECT_DIR}` inside `settings.json`'s `env` block, `somi::audit_log_path` returned
  the literal string and `mkdir -p` created a `${CLAUDE_PROJECT_DIR}/` directory in the repo root. The
  resolver now discards any candidate containing an unexpanded `${…}` and falls back to a
  shell-resolvable path (`hooks/lib/common.sh`).
- **`/code-loop`'s circuit breaker could miss a recurring finding.** It matched recurrences by
  `file:line + title`, but line numbers shift between passes, so the same logical finding at a moved
  line slipped past the breaker and let coder and reviewer oscillate to the pass cap. Matching is now
  `file + nearest symbol/function + title`. The same fix is applied to `/ship-loop`'s cross-layer
  breaker.
- **`/code-loop`'s diff cap was measured against an undefined baseline.** The loop now captures
  `BASELINE_SHA` once at initialization and measures the cumulative working-tree diff against it, so
  the cap means the same thing whether the coder commits each pass or leaves an uncommitted tree.

## [0.3.0] — 2026-06-02 — Discovery & requirements-engineering workflow

### Added

- **`/discover` — a new upstream discovery workflow** (the requirements-engineering and high-level
  software-design phase of the SDLC, before planning or coding). Turns a raw product idea into a
  research-grounded, traceable foundation under `.somi/rd/<slug>/` and hands it to `/plan`. Optional
  and greenfield-only; incremental work still starts at `/plan`.
- **`discovery-analyst` agent** — requirements engineer + product strategist + software architect in
  one. Performs extensive competitive and complaint research (every non-obvious claim cited; signal
  vs. noise distinguished; fabrication forbidden), then authors the document set with full
  traceability and inline user verification at every crossroads. Runs on `opus`.
- **`/discover` runs `opus` end-to-end** — the one deliberate exception to the
  `sonnet`-orchestrator / `opus`-agent split. Its output is the cornerstone of a new project, so the
  orchestration runs on the most capable model too. Documented in `docs/COMMANDS.md` / `docs/AGENTS.md`.
- **Two new skills**: `market-research` (competitor scan, complaint mining, churn analysis,
  signal-vs-noise, citation discipline, turning findings into requirements/non-goals/risks) and
  `requirements-engineering` (INVEST, MoSCoW, functional vs non-functional, acceptance criteria,
  traceability, ambiguity elimination, and which document holds what).
- **R&D document templates** under `templates/`: `RD-README.md.tmpl` (index + traceability map),
  `RESEARCH.md.tmpl`, `BRD.md.tmpl`, `SRS.md.tmpl`, `FRD.md.tmpl`, `SDD.md.tmpl`, `TDD.md.tmpl`. The
  `decisions.md` / `diary.md` for an initiative reuse the existing templates.
- **`examples/discovery-example.md`** — a worked walkthrough of a `/discover` run.

### Changed

- **`/plan` and the `planner` agent consume an R&D foundation when present.** If `.somi/rd/<slug>/`
  exists, the planner treats the SRS/FRD as the requirements source (`spec.md` cites `FR-*`/`NFR-*`
  IDs), the SDD/TDD as architectural direction (carried into `decisions.md`, re-opened only where
  planning genuinely diverges), and the research report as risk context. **Not mandatory** —
  planning still works from a bare problem statement.
- **`inject-workflow-context.sh`** now tracks `.somi/rd/**/README.md` in its state signature and
  surfaces an "active discovery" / "R&D foundation ready" hint, mirroring the existing plan hint.
- **Docs updated throughout** — `WORKFLOWS.md` (new workflow, diagram, "why discovery is separate"),
  `COMMANDS.md`, `AGENTS.md`, `SKILLS.md`, `USAGE.md`, `architecture.md`, `EXTENDING.md`, both
  READMEs, `rules/CLAUDE.md`, and `rules/50-collaboration.md` (Discovery → Planning handoff).

## [0.2.0] — 2026-06-01 — Audit-driven overhaul

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

[0.4.0]: https://github.com/skathio/somi-ai/releases/tag/v0.4.0
[0.3.0]: https://github.com/skathio/somi-ai/releases/tag/v0.3.0
[0.2.0]: https://github.com/skathio/somi-ai/releases/tag/v0.2.0
[0.1.0]: https://github.com/skathio/somi-ai/releases/tag/v0.1.0
