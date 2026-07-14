# Changelog

All notable changes to `@skathio/somi` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — versioning: [SemVer](https://semver.org/).

## [Unreleased]

_Nothing yet._

## [2.0.2] — 2026-07-14 — fix: `somi-findings.mjs record` crashed instead of erroring cleanly on an unreadable stdin

**Patch — bug fix.** A library consumer running under GitHub Copilot on Windows hit a raw,
uncaught-exception crash ("stdin is not a tty") instead of a clean error message.

- **`scripts/somi-findings.mjs`'s `record` subcommand now handles a failed stdin read.** Every
  documented invocation (`commands/review.md`, `commands/code-loop.md`, `commands/plan-loop.md`,
  `commands/review-panel.md`) pipes JSON in (`echo '<json>' | node scripts/somi-findings.mjs
  record …`); if an agent host reconstructs that pipeline differently — as happens on
  Windows, where a synchronous read of a TTY console handle throws `EAGAIN` instead of blocking
  (a known Node/libuv limitation, unlike POSIX) — `fs.readFileSync(0)` threw, and that throw had
  no try/catch, so it escaped as a raw stack trace (exit `1`) instead of the script's own
  `die()` convention (a one-line message, exit `64`) that every other error path here already
  uses. The read is now guarded the same way; a failure produces `somi-findings: failed to read
  stdin — findings must be piped in as a JSON array` instead of a crash.
- The sibling call site (`hooks/lib/common.mjs`'s `readPayload()`, used by every hook) was
  checked and was already safe — no change needed there.

No migration action required; this only affects the error path taken when stdin can't be read.

## [2.0.1] — 2026-07-13 — fix: runtime state and project overrides under `.claude/` instead of `.somi/`

**Patch — bug fix.** Consumers of the plugin were getting SoMi-owned, project-local assets created
under `.claude/` instead of `.somi/`. Fixed, in code and in every doc that documented the old paths:

- **`audit.log`** — `hooks/lib/common.mjs`'s default (and the vendored reference
  `.claude/settings.json`'s `SOMI_AUDIT_LOG`) now resolve to `.somi/audit.log`, not
  `.claude/audit.log`.
- **`somi-state/`** (loop state, context-injection signature) — `scripts/somi-loop.mjs` and
  `hooks/user-prompt-submit/inject-workflow-context.mjs` now default to `.somi/somi-state/`, not
  `.claude/somi-state/`.
- **`99-overrides.md`** — the project's escape-hatch file now defaults to
  `.somi/rules/99-overrides.md`, not `<project-root>/rules/99-overrides.md`. SoMi has two host
  surfaces (Claude Code, GitHub Copilot), so a project-root `rules/` or a `.claude/`-rooted path is
  ambiguous and collides with the plugin's own install layout; `.somi/` is host-neutral and already
  the documented home for every other project-local SoMi artifact. `commands/adopt.md` (the only
  place that writes this file today) is updated accordingly; `rules/99-overrides.md` in the plugin
  source remains the starter template `/adopt` scaffolds from.

No migration action is required for new installs. Projects with existing `.claude/audit.log` or
`.claude/somi-state/` from a prior install may delete them (or leave them — SoMi will not read from
or write to them again) once this version is picked up.

## [2.0.0] — 2026-07-10 — portable Node runtime (jq-free, bash-free, Windows-capable, Copilot-native)

**This is a MAJOR release** (breaking — see below). SoMi's entire deterministic runtime — the loop-state
engine, findings ledger, working-tree guard, and all 8 hooks + the shared lib — was ported from
`bash`+`jq` to **zero-dependency Node** (`.mjs`, stdlib only). The motivation: corporate networks
often block installing `jq`, and `bash` is not native on Windows; both are removed. Every `.mjs` was
proven byte-parity against its retired bash original via an expanded golden-fixture corpus (152 cases),
and the security-critical `block-dangerous-bash` port passed a mandatory `security-reviewer` gate
(which caught and fixed two `deny→allow` under-gates before they shipped). The bash originals are
deleted; the Node sources are what Claude Code, the vendored install, `npx somi-check`, and `npm test`
now run.

### Breaking changes

- **Every shipped script/hook is now `.mjs`, not `.sh`.** The retired `.sh` sources under `scripts/`
  and `hooks/` are **deleted**. Consumers who reference a bash source **by path** must repoint:
  - `scripts/somi-check.sh` → `scripts/somi-check.mjs` (the `bin` and the documented
    `ln -s … .git/hooks/pre-commit` are updated; `somi-check.mjs` carries a `#!/usr/bin/env node`
    shebang and is executable, so the symlink path still works).
  - The 8 hook `.sh` and `hooks/lib/common.sh` are gone; anyone wiring a hook by direct `.sh` path
    must use the `.mjs`. **The documented install paths are unaffected and continue to work**: the
    plugin auto-merges `hooks/hooks.json` (`${CLAUDE_PLUGIN_ROOT}`), the vendored install uses
    `.claude/settings.json` (`${SOMI_VENDOR_ROOT}`), and both now invoke `node …/*.mjs`.
  - **Migration**: if you install via the plugin marketplace or the vendored `.claude/settings.json`,
    **no action** — the paths are internal and already updated. Only repoint if you hand-wired a
    somi `.sh` by its literal path (custom pre-commit symlink, bespoke `hooks.json`, a script that
    `source`d `hooks/lib/common.sh`): swap the `.sh` for the same-named `.mjs` and invoke it with
    `node`. **A `node` runtime is now required** where a POSIX shell + `jq` used to be.
- **SessionStart no longer surfaces nested instruction files inside `.git`/`node_modules`/`.somi`/
  `vendor`.** The bash prune was non-functional (GNU `find`'s `-mindepth 2` suppressed `-prune`); the
  Node port makes it fire as documented. A third-party `CLAUDE.md` inside `node_modules/` is no longer
  injected as if it were the repo's own convention. (decision D6)
  - **Migration**: if you actually relied on a nested `CLAUDE.md`/`AGENTS.md` (e.g. inside a vendored
    dependency) being surfaced at session start, move or symlink it to the repo root — only root-level
    and non-pruned subtrees are injected now.
- **UserPromptSubmit now detects bare-backtick `` `in-progress` `` status lines** — the format
  `/plan` actually generates — so more work-item context surfaces at prompt time than before. Bounded
  and empirically checked against false positives (1 match in a 1255-line `progress.md`). (decision D7)
  - **Migration**: none required — this is additive context injection. If a `progress.md` surfaces
    more than you want, mark completed items so they no longer read as `` `in-progress` ``.

### Removed

- **The `jq` runtime dependency.** No shipped script or hook invokes `jq`; JSON is handled by the Node
  standard library.
- **The `jq` + `shellcheck` CI/validation install.** `scripts/validate.sh` now validates JSON via
  `node -e JSON.parse` and source syntax via `node --check` over the `.mjs`; `publish.yml` no longer
  `apt-get install`s either binary. (`validate.sh` and the two `tests/*/run.sh` runners remain bash as
  dev/CI tooling — they call neither jq nor shellcheck.)

### Added

- **Root [`AGENTS.md`](AGENTS.md) + [`.github/copilot-instructions.md`](.github/copilot-instructions.md)**
  carrying the always-on rules digest. GitHub Copilot loads these natively (it does not read
  `rules/CLAUDE.md`), so SoMi's guardrail digest now reaches Copilot without the extension — closing a
  silent gap. Includes an explicit "refuse to weaken security checks" directive for Copilot, where the
  deterministic hooks don't fire and agent judgment is the only enforcement layer. (decision D3)
- **Windows-capable runtime.** The state scripts and hooks run via `node <file>` with no `bash` and no
  `jq`, so they run identically on Windows, Linux, and macOS. **Caveat (not yet closed):** the
  path-matching guards (`guard-protected-paths`, `block-secret-writes`) build forward-slash globs, and
  their behavior against native Windows `\`-separated paths is unverified — a tracked follow-up, **not**
  a claim of full guard parity on Windows. The Claude Code ↔ Copilot parity caveat is unchanged: hooks
  are a Claude Code capability and do not fire under Copilot.

> **Note for the release manager:** one item was consciously deferred — a live-wiring smoke test (a real
> per-event Claude Code session proving the manifest `command` dispatch fires the `.mjs`) was waived in
> favor of revert-as-safety-net; the residual "silent no-fire" risk should be closed by a fast-follow
> live smoke test on first real plugin load. See the work item's follow-ups.

## [1.2.0] — 2026-07-02 — trust core, deterministic loops, and the lifecycle completers

Three arcs in one minor release. **Trust core:** every load-bearing guarantee that was
documentation-only became mechanical — guardrails behaviorally tested in CI, user verification
that cannot be self-answered by an agent, briefs that cannot go silently stale. **Deterministic
loops:** the bounded loops' arithmetic (pass caps, diff caps, circuit breakers) moved from model
discipline into shipped, tested scripts with durable, resumable state and a findings ledger.
**Lifecycle completers:** nine new commands covering the problem shapes daily engineering
actually has — debugging, status/routing, PR handoff, repo onboarding, impact analysis,
dependency upgrades, release gating, and incidents. Nothing is removed or renamed; all existing
commands, agents, artifacts, and hook paths are unchanged (additive per the
[versioning policy](docs/VERSIONING.md) — hence MINOR).

### Added

- **`/atlas` — the Repo Atlas** (`commands/atlas.md` + `templates/ATLAS.md.tmpl`): one MAX-tier
  deep read of the codebase (module map, dependency rules, conventions digest, hotspots, test
  topology) written to a SHA-stamped `.somi/atlas.md`. Later MAX actions (`/design`, cold
  `/plan`, `/refactor` analysis, `/impact`) start from the atlas and deep-read **only the drift
  since its SHA** — amortizing the repo read across work items instead of paying it per feature.
  Consumers run the staleness check before trusting it; the brief's "Repo conventions in force"
  cites `atlas.md §4` instead of re-deriving. CI asserts the command's `opus` tier.
- **`/impact` — change-impact analysis** (read-only, atlas-first): blast radius with counts
  (callers per module, contracts crossed, test coverage and gaps, migration surface), the
  `/review-panel` lenses the surface warrants, and a *proceed / design-first / reconsider*
  recommendation. Runs before `/design`/`/plan` when the change's cost is the open question.
- **`/adopt` — brownfield onboarding composite** (one-time per repo): builds the Atlas, drafts
  `99-overrides.md` **pre-filled with detected conventions** (user confirms before any write —
  the batch verification protocol applied to onboarding), produces an adoption gap report (test
  thin ice, hotspots, candidate first refactors, guardrail-fit `.somi/config.json` suggestions),
  and recommends a calibration work item.
- **`/upgrade` — dependency upgrade validation**: cited changelog/breaking-change/CVE research
  (the `discovery-analyst`'s integrity rules at upgrade scope) → usage scan of the flagged
  APIs → mini-`brief.md` that doubles as the dep-gate sign-off record → human gate → migration
  under `/code-loop`. Patch/minor with nothing breaking → recommends the short path instead of
  manufacturing ceremony.
- **`/release-readiness` — the pre-release gate**: a deterministic checklist over existing
  artifacts (iterations done, open `F-<n>` Blockers/Majors via the ledger, DoD, real
  rollout/rollback, interrupted loops, `somi-check --all`) + **one** MAX fresh-context review of
  the cumulative integration diff (what per-iteration reviews structurally miss). Verdict
  (`ready` / `ready-with-conditions` with named owners / `not-ready`) + draft release notes
  generated from specs and diaries. The checklist cannot be argued green.
- **`/incident` — the sanctioned emergency lane**: minimal framing → mitigate
  (flag > revert > scoped patch; **hooks stay on**; live diary timeline) → **mandatory** debt
  capture: blameless postmortem note, a seeded `/debug`/`/plan` follow-up (an incident with no
  follow-up does not close), and a one-question guardrail retro. Exists so urgency doesn't mean
  bypassing SoMi — which is when the guardrails matter most.
- **`somi-check` — the portable working-tree guard** (`scripts/somi-check.sh`, npm `bin`): the
  working-tree subset of the hook guarantees for hosts where hooks don't run (Copilot, CI, git
  `pre-commit`): staged secret-bearing files, lockfile hand-edits (lockfile without its
  manifest; honors `lockfiles.allow_edit` / `SOMI_ALLOW_LOCKFILES`), added
  `TODO(claude)`/`FIXME(claude)` markers, scratch/backup files. Exit 1 on findings; tested in
  `tests/scripts/run.sh`; recipes in HOOKS.md/PLUGIN.md.

- **The deterministic loop core** — the bounded loops' arithmetic moves from model discipline
  into shipped, tested scripts:
  - **`scripts/somi-loop.sh`** — per-loop state at `.claude/somi-state/loop/…json`: baseline SHA
    captured once, caps resolved (flag > env > `.somi/config.json` > default), pass counting
    (exit `2` past the cap), weighted diff measurement (exit `3` over the cap; working tree
    included; **`.somi/`/`.claude/` excluded** so artifact churn no longer eats the code budget;
    out-of-scope files count double), per-pass history (verdict/counts/diff — run telemetry).
    Durable state means **loops resume after session death** (`resume`) instead of re-guessing
    baselines from a dead conversation.
  - **`scripts/somi-findings.sh` — the findings ledger** at `.somi/reviews/<slug>/findings.json`
    (committed; machine view beside the markdown reviews). Findings get stable ids (`F-<n>`), a
    stable locus (file + symbol + normalized title — never line numbers), and a lifecycle
    (`open → fixed/accepted/wontfix`). Recurrence is computed mechanically: consecutive-pass
    recurrence (exit `5`) is the `/code-loop` / `/plan-loop` circuit breaker; cross-run
    recurrence backs `/ship-loop`'s cross-layer breaker — both now work **across sessions**.
    `/review` starts by re-checking open findings; `/review-panel` records the merged set;
    `progress.md` follow-ups reference `F-<n>`.
  - `/code-loop`, `/plan-loop`, `/ship-loop` rewritten around the scripts (judgment stays with
    the model; counting doesn't), with an explicit host fallback to the old judgment-enforced
    tracking. End-to-end tests in `tests/scripts/run.sh` (cap precedence, weighted diff,
    resume, breaker semantics) run in CI. `scripts/` + `tests/` now ship in the npm package.
- **`/debug` — the debugging workflow** (`commands/debug.md` + `templates/RCA.md.tmpl`): for
  bugs whose cause is **not yet isolated** — the problem shape SoMi previously had nothing for.
  Reproduction is a non-overridable gate (failing test preferred — it stays as the regression
  guard); isolation runs a bounded hypothesis loop (default 5 — `debug.max_hypotheses` /
  `SOMI_DEBUG_MAX_HYPOTHESES`) with a **fresh-context MAX diagnosis hatch** (the `reviewer` on
  the evidence only) when narrowing stalls; the fix runs under `/code-loop` with the repro as
  acceptance; the deliverable is a one-page `rca.md` (symptom, repro, cause chain with
  `file:line`, fix rationale, blast radius, "why no test caught this"). Deliberately
  lightweight — no spec/phases ceremony; hands off to `/plan` if diagnosis reveals a
  feature-sized fix or a wrong architectural decision.
- **`/somi` — status dashboard & router** (`commands/somi.md`, read-only): bare `/somi` renders
  every work item / discovery / interrupted-resumable loop / open finding with a mechanically
  derived **next action**; `/somi <request>` classifies the problem shape and recommends the
  entry command — checking for an existing matching work item first, and never auto-invoking.
- **`/pr` — PR handoff** (`commands/pr.md`): composes the PR title + description from the work
  item's artifacts (spec/rca, verified decisions, plan-change diary entries, test evidence,
  review verdicts + open `F-<n>` findings with disposition), respects the repo's own PR
  template/house style, and runs `gh pr create` only after explicit confirmation.
- **Hook behavior test suite.** New `tests/hooks/run.sh` + fixture cases under
  `tests/hooks/cases/` (67 deny/allow cases across all four pre-tool guards), wired into
  `scripts/validate.sh` (`npm test`) and therefore CI. Each case pipes a payload into the real
  hook script under a sanitized environment and asserts the decision — a pattern edit that
  silently weakens a guarantee now fails CI. Adding a hook rule now requires a fixture
  (see `docs/HOOKS.md` §Testing hooks).
- **`.somi/config.json` — committed per-project configuration.** Loop caps
  (`code_loop.*`, `plan_loop.*`, `ship_loop.*`, `design_loop.*`, `discover_loop.*`,
  `parallel.*`) and hook policy become reviewable project policy instead of per-session env-var
  folklore. Precedence everywhere: **env var > config > default**. New hook policies:
  `dep_install.allow` (package-name **prefix** allowlist for `gate-dep-install` — scoped, unlike
  the all-or-nothing `SOMI_ALLOW_DEP_INSTALL=1`; compound commands never qualify and every
  package must match) and `lockfiles.allow_edit`. New `somi::config` helper in
  `hooks/lib/common.sh`. See `docs/USAGE.md` §Project configuration.
- **Brief supersession overlay.** `templates/BRIEF.md.tmpl` gains an append-only
  **`§10 Supersessions`** section, closing a staleness hole: the plan-change protocol updated
  spec/decisions/phases/progress but never the brief — yet the brief is the ECO tier's cached
  primary input, so a superseded decision kept being served as "in force" to every later pass.
  The protocol (in `/code`, the `coder`, and the docs) now appends a supersession line to §10
  (§1–§9 stay byte-stable for the prompt cache); brief consumers (`planner`, `coder`, `/plan`,
  `/code`) apply §10 as an overlay on §2 before trusting a decision; the `reviewer` treats a
  superseded decision with no §10 line as a **stale-brief finding**.

### Changed

- **Dangerous-bash guard hardened** (`hooks/pre-tool/block-dangerous-bash.sh`) — closes three
  bypasses found in review:
  - All checks also run against a **quote-stripped copy** of the command, so
    `bash -c "rm -rf /"` can't hide inside quoting.
  - **Force-push without an explicit target branch is denied** (`git push -f`,
    `git push -f origin`, `git push -f origin HEAD`): the current branch can't be verified and
    may be protected — naming the branch is what makes the protected-branch check meaningful.
    `+refspec` force-pushes to protected branches (`git push origin +main`, `+HEAD:main`) are
    also denied.
  - **Shell-level writes to secret-bearing paths are denied** (`> .env`, `>> …/.env`,
    `tee .env`, `sed -i … .env`, `cp`/`mv` onto a secret path) — the Bash-side twin of
    `block-secret-writes.sh`, whose `Write|Edit` matcher those shapes bypassed entirely.
    `.env.example`-style templates stay allowed.
- **Protected-paths guard normalises relative paths** (`guard-protected-paths.sh`), so a relative
  `node_modules/x.js` can't slip past the `*/node_modules/*` globs.
- **Verification protocol mechanics made explicit — the batch round-trip.** A Tasked subagent
  cannot pause mid-run to converse with the user, so "pauses inline for verification" was
  mechanically unimplementable and risked silently self-answered decisions. The
  `planner` / `designer` / `discovery-analyst` research pass now ends by returning a
  **`DECISIONS-NEEDED` block** (options with concrete pros/cons, recommendation, pre-supplied
  narrowing questions that power Discover mode); the calling command owns the user conversation
  and re-invokes the agent with a **`VERIFIED-DECISIONS` block appended** (append-only keeps the
  briefing prefix cache-warm); only then are decisions recorded `Verified with user: yes`. An
  agent never marks a decision user-verified in the same pass that generated it. Block shapes
  are canonical in `agents/planner.md`; `/plan` §5 defines the command side; `/design`,
  `/discover`, `/ship`, `/plan-loop` (a `DECISIONS-NEEDED` return pauses the loop and never
  counts toward caps or divergence), `docs/AGENTS.md`, and `rules/50-collaboration.md` updated
  to match. User-visible behavior is unchanged — you still verify every decision.

### Fixed

- Templates no longer carry plugin-relative links (`../commands/…`, `../../../skills/…`) that
  break once instantiated into a consumer repo's `.somi/` (BRIEF, PHASE, SRS, SDD, TDD,
  RD-README — now plain-text command/skill names).
- `templates/DOD.md.tmpl` referenced the pre-1.x `.somi/<slug>/` layout; paths corrected to
  `.somi/plans/<slug>/` / `.somi/reviews/<slug>/`, and the template is now referenced from the
  GOVERNANCE adoption checklist instead of being orphaned.
- `commands/plan.md` §4 pointed at the wrong section (§6) for the verification protocol.

## [1.1.1] — 2026-06-29 — CI/CD migrated to hashira v2

### Changed

- **CI/CD pipeline migrated to [`skathio/hashira`](https://github.com/skathio/hashira)'s v2
  contract.** Releases are now cut via an explicit `workflow_dispatch` with a `bump`
  (`patch`/`minor`/`major`) input, resolved by hashira's version-resolver — replacing
  `semantic-release`'s commit-message-driven inference. npm publishing uses OIDC trusted
  publishing (no `NPM_TOKEN`). CI now also runs hashira's shared `npm-package-ci.yml` (commitlint,
  CodeQL/OSV/Gitleaks/dependency-review, coverage reporting) alongside the existing
  `scripts/validate.sh` and publishability dry-run checks.
- No behavior change to any `/command`, agent, hook, or template — this release is CI/tooling only.

## [1.1.0] — 2026-06-23 — MAX/ECO economy & the execution brief

Re-tiers SoMi's models on the **SDLC-phase axis** instead of the orchestration axis. A **MAX** tier
(`opus`) front-loads the expensive reasoning — research, design, decisions, complexity mapping,
fresh-eyes review — into a dense, bounded **`brief.md`**; an **ECO** tier (`sonnet`) then executes
against that brief *without re-researching*. Previously every agent ran `opus`, spreading the
expensive model across the whole lifecycle (including the highest-volume work). Now `opus` is
concentrated where it pays off — the front-loaded brief and review — and the bulk token volume (plan
detail, iterative coding) runs on `sonnet`. This is the **plan-and-execute / model-cascade** pattern,
with **LLM-as-judge on fresh context** for review.

### Added

- **`/design` — feature/user-story design (MAX tier).** New command + `designer` agent. Settles a
  **brownfield** feature's architecture against the existing codebase — the gap between `/discover`
  (a whole new product) and `/plan` (sequencing). Reads the repo deeply, resolves the
  expensive-to-reverse calls with the user (same verification protocol as the planner), maps the
  complexity, and compiles the `brief.md`. Runs `opus` end-to-end (like `/discover`).
- **The execution brief (`templates/BRIEF.md.tmpl` → `brief.md`).** The dense, bounded MAX→ECO
  handoff every MAX action emits: decisions in force, a complexity map (`file:line`), a file map, the
  repo conventions in force, constraints/non-goals, open risks — and an explicit **"What ECO does NOT
  need to re-research"** list. References its deep docs rather than inlining them, so it doesn't bloat
  context. `/discover`, `/design`, and `/refactor` analysis all produce one; `/plan` and `/code`
  consume it.
- **`templates/DESIGN.md.tmpl`** — the feature design doc the brief references (`design.md`).
- **Repo-awareness (respect as context).** A new **SessionStart hook**
  (`hooks/session-start/detect-repo-instructions.sh`) surfaces a repo's own instruction files
  (`CLAUDE.md` root + nested, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursorrules`) and any
  `.claude/agents/`. MAX actions read them once and distil the conventions into the brief, so the ECO
  tier inherits them without re-reading. Repo-local instructions **win** over SoMi defaults; SoMi
  **never auto-invokes** foreign agents.
- **MAX review loops.** `/design`, `/discover`, and `/refactor` analysis can run a bounded
  produce → review → revise loop in **MAX scope** (mirroring `/plan-loop` / `/code-loop`), and
  `/review` now accepts a `design <slug>` target — review a design + `brief.md` on a **fresh
  context**, artifacts-only, so the review isn't biased by the producer's reasoning.

### Changed (behavior — documented)

- **Default model tiers re-assigned.** `planner` and `coder` move `opus` → **`sonnet`** (ECO). All
  reviewers plus `discovery-analyst`, `designer`, and `refactorer` stay `opus` (MAX). Overridable per
  project in the agent frontmatter. **Upgrade note:** if you depend on `opus`-grade planning/coding
  with no MAX front-load, either run `/design` first (recommended — it compiles the brief the ECO
  tier needs) or set `planner`/`coder` `model: opus` in your install.
- **`/ship-loop` is now the continuous, model-switch-gated pipeline.** It optionally front-loads a MAX
  action, gates a **single** human checkpoint **at the MAX→ECO model switch** (review the brief), then
  runs `/plan-loop` → `/code-loop` to completion **under the bounded caps with no per-iteration human
  stop**. For a cold start (no MAX action), the gate falls to after `/plan-loop` — never fully
  gateless. **Upgrade note:** the old per-iteration `next` prompt is gone; the caps (per-layer +
  global budget + cross-layer breaker) are the safety net. Use `/ship` for a human gate at every
  stage.
- **`/refactor` gains an analysis mode.** Small named smells still take the surgical path; large
  refactors (multi-module, migrations, shared-shape changes) run a MAX analysis that compiles a
  refactor `brief.md`, then `/plan-loop` → `/code-loop` execute it under bounded gates.
- **`/plan` gains a depth gate.** A cold, design-heavy plan with no upstream brief now recommends
  `/design` (MAX) first rather than under-thinking the architecture on the ECO tier.
- **Loop commands document cache-prefix discipline.** Keeping `rules/CLAUDE.md` + `brief.md` + the
  spec/phase prefix byte-stable across passes lets the 5-minute prompt cache hit — a direct token
  saving in multi-pass loops.

### Notes

- No command was removed or renamed; `.somi/` artifact layout is backward-compatible (the brief and
  design files are additive). Existing plans without a `brief.md` continue to work — the planner/coder
  fall back to reading the full artifact set.

## [1.0.0] — 2026-06-21 — Rename to **SoMi** (`@skathio/somi`)

First stable release under the new name. This is a **breaking change**: the project, npm package,
and GitHub repository were all renamed from `somi-ai` to `somi`.

### Changed (BREAKING)

- **npm package** renamed `@skathio/somi-ai` → `@skathio/somi`. The old package is no longer
  updated; `@skathio/somi-ai` is deprecated and pinned at its last `0.x` release.
- **GitHub repository** renamed `skathio/somi-ai` → `skathio/somi` (old URLs redirect).
- **Plugin / Copilot-extension / marketplace identifiers** renamed `somi-ai` → `somi`.
- **Brand / display name** `SoMi AI` → `SoMi`.

### Migration

- Reinstall from the new package/marketplace: `@skathio/somi` (see the README for plugin and
  Copilot-extension install commands). No behavior or workflow changes accompany the rename — only
  the name.

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

First public release of SoMi.

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

- Claude Code plugin: marketplace manifest (`.claude-plugin/`) and npm package (`@skathio/somi`).
- GitHub Copilot extension: `.copilot-extension/` manifest mirrors the Claude Code plugin.
- Validator workflow (`.github/workflows/validate.yml`): JSON, shellcheck, frontmatter checks.
- Release workflow (`.github/workflows/release.yml`).

#### Documentation and examples

Full documentation set: install, usage, workflows, agents, hooks, skills, rules, commands,
extending, versioning, governance, plugin, architecture.

Worked examples: feature plan (full six-artifact walkthrough), code review, end-to-end pipeline
transcript, and a sample consuming project showing the post-install layout.

[1.0.0]: https://github.com/skathio/somi/releases/tag/v1.0.0
[0.4.0]: https://github.com/skathio/somi/releases/tag/v0.4.0
[0.3.0]: https://github.com/skathio/somi/releases/tag/v0.3.0
[0.2.0]: https://github.com/skathio/somi/releases/tag/v0.2.0
[0.1.0]: https://github.com/skathio/somi/releases/tag/v0.1.0
