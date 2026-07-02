# Usage

Hands-on guide to running the workflows. For each command, this doc shows: when to use it, what
to type, what to expect, and where the artifacts go.

## The fundamental loop

```
MAX tier (opus) — front-load reasoning into a dense brief.md:
/discover <idea>           →  .somi/rd/<slug>/ + brief.md     →  user reviews + approves
   ↓ (new product)           (research + BRD/SRS/FRD/SDD/TDD)
/design <feature>          →  .somi/plans/<slug>/ + brief.md  →  user reviews + approves
   ↓ (brownfield, design-    (design.md + decisions + brief)
   ↓  heavy feature)
─────────────────────────  MAX→ECO model switch  ─────────────────────────
ECO tier (sonnet) — execute against the brief, cheaply:
/plan <problem|slug>       →  .somi/plans/<slug>/ created    →  user reviews + approves
   ↓                          (consumes brief.md as primary input)
/code-loop <slug>           →  diff + tests + review files;  →  user inspects
       phase N, iteration M    bounded by caps (max passes,
                               severity floor, diff cap)
   ↓
(next iteration; or merge if done)
```

The **MAX** front-loads (`/discover` for a new product, `/design` for a brownfield design-heavy
feature) compile a dense `brief.md` so the **ECO** tier (`/plan`, `/code`) executes *without
re-researching*. Incremental work with a settled design skips the front-load and starts at `/plan`;
a cold design-heavy plan triggers `/plan`'s depth gate, which recommends `/design` first.

`/code <slug>` runs a single coder pass without the review loop. `/code-loop` is the bounded
code↔review cycle for a single iteration. `/ship` runs the whole pipeline with hard gates at every
stage; `/ship-loop` runs it continuously, gating once at the MAX→ECO model switch.

---

## `/discover`

**When**: a **new product or greenfield initiative** described as an idea, not yet specified — or a
major new capability where "what should we even build, and is it worth building" is the real
question. Runs the requirements-engineering & high-level-design phase of the SDLC before any
planning.

**Skip**: incremental work with settled requirements (go straight to `/plan`); bug fixes; refactors.

**Type**:
```text
/discover A self-hosted alternative to Calendly for clinics, with HIPAA-aware scheduling, SMS
          reminders, and no per-seat pricing.
```

**Expect**:
- SoMi proposes a slug (e.g., `clinic-scheduler`) and confirms with you.
- Runs on the **most capable model end-to-end** (the `/discover` command itself is `opus`, not just
  the agent) — its output is the cornerstone of the project.
- **Researches the competition extensively** — scans direct/indirect competitors, mines real user
  complaints and churn reasons, and surfaces recurring failure modes to design *away* from. Every
  non-obvious claim is cited; signal is distinguished from noise; nothing is fabricated.
- **Pauses on each crossroads** — target persona, scope boundaries, build-vs-integrate, the one or
  two expensive-to-reverse architectural calls — presenting options with concrete pros/cons
  (grounded in the research), a recommendation, and `Other` / `Discover` escape hatches. You decide.
- Authors the document set under `.somi/rd/<slug>/`: `research-report.md`, `brd.md`, `srs.md`,
  `frd.md`, `sdd.md`, `tdd.md`, plus `decisions.md`, `diary.md`, and a `README.md` index with a
  traceability map. The list adapts — a document the project needs is added, one that would be
  ceremony is omitted, each with a reason in `README.md`.
- Sets `README.md` status to `ready-for-planning` and summarises back: product framing, top
  competitive insights, must-avoid pitfalls, top risks, and the next step.
- **Stops.** Does not plan or code.

**Then**:
- Read `.somi/rd/<slug>/README.md`, then `srs.md` and `sdd.md`. Edit any file directly — they're
  your artifacts.
- When happy: `/plan <slug>`. The planner consumes the SRS/FRD as the requirements source and the
  SDD/TDD as architectural direction, re-opening a decision only where it genuinely diverges.

See [`examples/discovery-example.md`](../examples/discovery-example.md) for a worked output.

---

## `/plan`

**When**: non-trivial change, multi-module work, anything touching security/auth/contracts, or any
request you can't restate in one sentence with confidence. For a **new product**, run `/discover`
first and then `/plan <slug>`.

**Skip**: trivial single-file bug fix, doc-only changes, renames.

**Type**:
```text
/plan Add per-team rate limiting to the public webhook ingestion endpoint with audit logging and
      an emergency kill switch.
```

**Expect**:
- SoMi proposes a slug (e.g., `rate-limiting-webhooks`) and confirms with you.
- Reads the relevant code (Read/Grep/Glob).
- Drafts `context.md` (background, surroundings, constraints — the **verbatim** user problem
  statement lands here, fenced as untrusted data) and the spec skeleton.
- **Pauses on each architectural decision** — presents 2–4 concrete options with explicit pros and
  cons, recommends one, and offers `Other` (you describe a different option) or `Discover` (the
  agent asks narrowing questions to help you choose).
- Records each verified decision in `decisions.md` with the chosen option, rejected alternatives,
  rationale, and (if you used discovery mode) the narrowing Q&A.
- Writes phases under `phases/<NN>-<slug>.md`, sets `progress.md` to `awaiting-approval`, and
  appends the first `diary.md` entry (which points back to `context.md` for the verbatim — no
  duplication).
- Summarises back: problem framing, phase count, top 3 risks, top 3 open questions, pointer to
  `.somi/plans/<slug>/`.
- **Stops.** Does not start coding.

**Then**:
- Read `.somi/plans/<slug>/spec.md` and `phases/01-*.md`.
- Edit any file directly if you want — they're your artifacts.
- Run `/review plan <slug>` for a skeptical pass on the plan itself (or `/plan-loop` for an
  automated revise→review cycle).
- When happy: `/code-loop <slug>` (or `/code <slug>` for a single pass without the loop).

See [`examples/feature-plan-example.md`](../examples/feature-plan-example.md) for a worked output.

---

## `/plan-loop`

**When**: ambiguous or architecturally heavy work where you want SoMi to iterate the plan
through reviewer feedback before you read it.

**Type**:
```text
/plan-loop Add per-team rate limiting to the public webhook ingestion endpoint.
/plan-loop rate-limiting-webhooks    # to continue revising an existing plan
```

**Expect**: bounded plan → review → revise cycles (default cap: 3). Stops on approve, on cap
hit, on divergence (plan keeps churning without findings dropping), or on user `stop`.
Architectural decisions still go through the planner's verification protocol even inside the
loop. See [`commands/plan-loop.md`](../commands/plan-loop.md) for the gate table.

---

## `/code`

**When**: you have an approved plan; or, for trivial work, a self-contained task description.
This is the **single-pass** form — for the bounded code↔review loop, use `/code-loop`.

**Type**:
```text
/code rate-limiting-webhooks                            # picks up next not-started iteration
/code rate-limiting-webhooks phase 1, iteration 1       # explicit target
/code Implement the in-memory RateLimiter described in phases/01-define-limiter.md
```

**Expect**:
- SoMi reads `spec.md`, the iteration's phase file, recent `diary.md`, and the surrounding
  code. Marks the iteration `in-progress` in `progress.md` (single source of truth for status).
- Edits or writes code, adds tests, runs them.
- If implementation reveals the plan needs to change (constraints, dead ends, false assumptions),
  it follows the **plan-change protocol**: updates spec/decisions/phases in place, updates
  `progress.md`, appends a `diary.md` entry, surfaces to you before continuing.
- Marks the iteration `done` in `progress.md`, appends a final diary entry.
- Summarises back: files changed, tests added, anything **not done**, plan changes (if any),
  tradeoffs, what to look at, next step (`/review <slug>`).

**Hook guardrails fire during this stage**: dangerous shell commands, secret writes, protected
paths, and unsanctioned dependency installs are denied deterministically. See [HOOKS.md](./HOOKS.md).

---

## `/code-loop`

**When**: same as `/code`, but you want the code↔review loop run automatically with bounds.

**Type**:
```text
/code-loop rate-limiting-webhooks phase 1, iteration 1
```

**Expect**: bounded code → review → fix cycles per iteration (default caps: 3 passes, Major
severity floor, 400-line diff cap, circuit breaker if the same finding recurs). Stops on
approve, cap hit, scope expansion, or user `stop`. See
[`commands/code-loop.md`](../commands/code-loop.md) for the gate table. Override caps per project
in `.somi/config.json` (`code_loop.*` keys — see [Project configuration](#project-configuration-somiconfigjson))
or per session via env vars (`SOMI_CODE_LOOP_MAX_PASSES`, `SOMI_CODE_LOOP_DIFF_CAP`, etc.; env wins).

---

## `/debug`

**When**: a bug whose **cause is not yet isolated** — intermittent failures, "works on my
machine", a stack trace pointing somewhere implausible. (Cause already known + trivial fix →
`/code`. Cause known + design-heavy fix → `/plan`.)

**Type**:
```text
/debug Webhook deliveries silently drop when the payload exceeds ~1MB; started after the v2.3
       deploy. CI link: <url>
```

**Expect**:
- SoMi proposes a slug, scaffolds a **lightweight** work item (`rca.md` + `progress.md` +
  `diary.md` — no spec/phases ceremony), and quotes the report as fenced data.
- **Reproduction is the gate**: no fix work until a failing test (preferred) or deterministic
  repro script exists, recorded in `rca.md` §2. Unreproducible → evidence recorded, handed back
  with what's missing; no hunch-fixes.
- **Bounded isolation**: one falsifiable hypothesis at a time (default budget 5 — config
  `debug.max_hypotheses`, env `SOMI_DEBUG_MAX_HYPOTHESES`); when narrowing stalls, a
  fresh-context MAX diagnosis pass (the `reviewer` on the evidence only) discriminates the
  remaining candidates.
- The **fix runs under `/code-loop`** with the repro test as acceptance — the usual caps apply,
  and a fix that blows the diff cap is treated as a signal the change is feature-sized (hand-off
  to `/plan`, RCA as input).
- The repro test **stays in the suite** as the regression guard; `rca.md` §6 answers *why no
  test caught this* (consulting `test-strategist` if the answer is a test-shape problem).

**Then**: read `rca.md` — symptom, repro, cause chain with `file:line`, fix rationale, blast
radius, follow-ups. It's the durable record for the next person who hits this class of bug.

---

## `/review`

**When**: before merge; after each iteration; whenever you want a skeptical second opinion. Use
`plan <slug>` for plan-level review (no separate `/plan-review` command).

**Type**:
```text
/review rate-limiting-webhooks         # reviews the latest iteration's diff against the spec
/review                                # working-tree diff, scoped if exactly one work item is in-progress
/review main..feature-x                # reviews a revision range
/review #1234                          # reviews a GitHub PR (if gh available)
/review plan rate-limiting-webhooks    # reviews the spec/decisions/phases (canonical form for plan review)
```

**Expect**:
- Severity-graded findings: Blocker / Major / Minor / Nit, each with High / Medium / Low
  confidence. Plan reviews use the plan-specific severity calibration.
- Plan-vs-code checks: did the diff stay within the iteration scope? Are decision changes
  captured?
- **Auto-invokes consultants** based on the trigger table in [`commands/review.md`](../commands/review.md):
  - Auth/crypto/input/upload/deserialization → `security-reviewer`.
  - New module/contract/service → `architecture-reviewer`.
  - Mock-heavy/flaky/wrong-shaped tests → `test-strategist`.
  Consultant findings are merged into the review under attributed sections.
- Written to `.somi/reviews/<slug>/<YYYY-MM-DD>-<phase>.<iter>-<verdict>.md` (or
  `…-plan-review-<verdict>.md` for plan reviews).
- A line in `progress.md` "Recent activity"; a diary entry if findings affect the plan.
- Summary: verdict, counts, top 3 findings.

See [`examples/code-review-example.md`](../examples/code-review-example.md) for a worked review.

---

## `/ship`

End-to-end pipeline: plan → code → review, with **hard human-in-the-loop gates** between stages.
Stage 2-3 (code↔review) delegates to `/code-loop` so it inherits caps automatically.

**Type**:
```text
/ship Add a --dry-run flag to the migrate CLI that prints the SQL it would execute without
      applying.
```

**Expect**:
- Stage 1 (Plan): creates `.somi/plans/<slug>/`, pauses on every architectural decision for
  verification, finishes with `progress.md` status `awaiting-approval`. Stops, asks `approve` /
  `revise` / `abort`.
- Stage 2 (Code, first iteration): invokes `/code-loop` for the iteration. Bounded by `/code-loop`'s
  caps. Stops, asks `next` or `stop`.
- Loops back to Stage 2 for the next iteration until done.

`/ship` does **not** skip review, verification, or rubber-stamp anything — the inner `/code-loop`
caps make sure cosmetic findings can't loop forever.

See [`examples/full-pipeline-example.md`](../examples/full-pipeline-example.md) for a transcript.

---

## `/ship-loop`

**When**: you want both layers (plan + code) automated under caps, with the mandatory human gate
between plan-done and code-start still in place.

**Type**:
```text
/ship-loop Add per-team rate limiting to the public webhook endpoint.
```

**Expect**: `/plan-loop` runs first; on success, **hard human checkpoint** (non-overridable);
then per-iteration `/code-loop`. Cross-layer circuit breaker stops if a finding recurs across
loops. Global budget caps total passes. See [`commands/ship-loop.md`](../commands/ship-loop.md).

---

## Specialised commands

### `/atlas`

Builds (or refreshes) the **Repo Atlas** at `.somi/atlas.md` — one MAX-tier deep read of the
codebase (module map, dependency rules, conventions digest, hotspots, test topology),
SHA-stamped. Later MAX actions (`/design`, cold `/plan`, `/refactor` analysis, `/impact`) start
from it and deep-read only the drift since its SHA, instead of re-reading the repo per work
item. Worth running once on any repo you'll do repeated SoMi work in; refresh after structural
changes. Commit it.

```text
/atlas
/atlas refresh
```

### `/somi`

The front door. Bare `/somi` prints a status table of every work item, discovery, interrupted
loop (resumable), and open finding — each with a mechanically derived **next action** ("answer
D4", "approve the plan then `/code-loop`", "address F-3"). With an argument, it classifies the
request's problem shape and **recommends** the right entry command (`/debug` vs `/plan` vs
`/design` vs `/review` …) — it never auto-invokes, and it checks for an existing matching work
item first so you don't scaffold duplicates.

```text
/somi
/somi users report the export button 500s since yesterday's deploy
```

### `/pr`

The exit ramp into your PR workflow: composes a PR title + description from the work item's
artifacts — spec §1 (or `rca.md` for a `/debug` item), verified decisions, plan-change diary
entries, test evidence, review verdicts and any open `F-<n>` findings with their disposition —
respecting the repo's own PR template and house style. Shows you the result and only runs
`gh pr create` after you confirm.

```text
/pr rate-limiting-webhooks
/pr fix-webhook-drops --draft
```

### `/security-review`

Targeted security review. Walks trust boundaries to sinks and produces attack-path-grounded
findings.

```text
/security-review rate-limiting-webhooks   # scoped to a work item's latest iteration
/security-review main..feature-x          # range
```

Use this in addition to `/review` when you specifically want the OWASP-Top-10 lens applied
without the rest of the code-review noise. (`/review` already auto-invokes
`security-reviewer` when its consultant-trigger table fires.)

### `/architecture-review`

Targeted architectural review. Restates the decision, evaluates forces, traces dependencies,
stress-tests the contract, checks reversibility.

```text
/architecture-review rate-limiting-webhooks
/architecture-review docs/adr/0042-event-bus.md
```

### `/test-strategy`

Designs or critiques a test strategy. Risk-driven coverage, level selection (unit/integration/e2e),
mock policy, determinism.

```text
/test-strategy rate-limiting-webhooks
/test-strategy src/order/service.ts
```

### `/refactor`

Surgical, behavior-preserving refactor of a named smell. Tests stay green; no feature work mixed
in.

```text
/refactor OrderService mixes pricing logic and persistence. Split pricing into a pure module and
          keep persistence behind a repository interface. Files: src/order/service.ts,
          src/order/repo.ts.
```

### `/review-panel`

Parallel multi-lens review. Seats the `reviewer` plus the security / architecture / test lenses **as
the diff warrants**, runs them concurrently on the same diff, and merges their findings into one
de-duplicated, severity-graded verdict (highest severity wins; lens disagreement is surfaced).

```text
/review-panel rate-limiting-webhooks                 # latest iteration of a work item
/review-panel main..feature-x                        # a range, before merge
```

Use it for a high-stakes change that crosses several concerns at once; use plain `/review` for the
everyday single pass. Inside `/code-loop`, set `SOMI_CODE_LOOP_REVIEW=panel` to make the loop review
with the panel. (On hosts without concurrent sub-agents — e.g. Copilot — the lenses run
sequentially; same result, slower.)

### `/impact`

Read-only blast-radius analysis **before** committing to `/design` or `/plan` (atlas-first when
one exists): callers/consumers with counts per module, contracts crossed, tests covering the
surface (and the gaps where regression risk concentrates), migration surface, and which
`/review-panel` lenses the change warrants. Ends with one of: *proceed small* (`/plan`),
*design first* (`/design`, report as pre-read), or *reconsider* — with the numbers.

```text
/impact rename the tenant_id column to org_id across the API
/impact src/billing/invoice.ts
```

### `/adopt`

One-time onboarding of SoMi into an existing repo: builds the Atlas, drafts `99-overrides.md`
**pre-filled with the detected conventions** (you confirm before anything is written), produces
a gap report (test thin ice, hotspots, candidate first refactors, guardrail-fit config
suggestions), and recommends a small calibration work item to run as `/ship` or `/debug`.

```text
/adopt
```

### `/upgrade`

Dependency upgrade validation, MAX→ECO shaped: cited changelog/breaking-change/CVE research →
usage scan of the flagged APIs → mini-`brief.md` (which doubles as the dep-gate sign-off
record) → human gate → migration under `/code-loop` with the full suite as acceptance.
Patch/minor with nothing breaking documented → it says so and recommends the short path.

```text
/upgrade prisma 5 → 6
/upgrade <link to the Renovate PR>
```

### `/release-readiness`

The pre-release gate: a deterministic checklist over the artifacts (all iterations done? open
Blocker/Major `F-<n>`s? DoD checkable? rollout/rollback real? interrupted loops?
`somi-check --all` clean?) plus **one** MAX fresh-context review of the *cumulative* release
diff — the integration surface per-iteration reviews never saw. Output: `ready` /
`ready-with-conditions` / `not-ready` with evidence, and draft release notes generated from the
work items' specs and diaries.

```text
/release-readiness rate-limiting-webhooks sso-login
/release-readiness the v2.4 milestone
```

### `/incident`

The sanctioned emergency lane: minimal framing → mitigate (flag flip > revert > scoped patch;
**hooks stay on**; every action gets a live diary timeline entry) → **mandatory** debt capture:
a blameless postmortem note, a seeded follow-up (`/debug` for the unknown cause, `/plan` for a
known-but-nontrivial fix), and a one-question guardrail retro. An incident with no follow-up
item does not close — the lane's speed is paid for by the accounting.

```text
/incident checkout 500s for ~20% of EU users since the 14:10 deploy
```

### `/code-parallel`

Builds **provably-independent** iterations concurrently, each in its own git worktree, then
integrates them **one at a time** with a full test run + review at every merge. Only iterations the
plan marks `Parallelizable: yes` with disjoint file sets are eligible; everything else runs
sequentially. A merge conflict means the iterations weren't actually independent — it's surfaced as a
planning signal, never auto-resolved.

```text
/code-parallel rate-limiting-webhooks            # eligible iterations across the active phase
/code-parallel rate-limiting-webhooks phase 2    # restrict to one phase
```

Conservative by design: when in doubt it falls back to plain `/code-loop`. Use it when a phase has
several genuinely independent slices and you want smaller, more focused per-iteration diffs.

---

## What happens to the artifacts

| Artifact                              | Lives at                                             | Lifetime                                          |
|---------------------------------------|------------------------------------------------------|---------------------------------------------------|
| Repo Atlas                            | `.somi/atlas.md`                                     | Persists; refresh via `/atlas` on structural drift |
| Project config (optional)             | `.somi/config.json`                                  | Committed team policy; env vars override per session |
| Discovery initiative (R&D foundation) | `.somi/rd/<slug>/` (research, BRD, SRS, FRD, SDD, TDD) | Persists indefinitely; only you delete it        |
| Work-item directory                   | `.somi/plans/<slug>/`                                | Persists indefinitely; only you delete it         |
| `context.md`, `spec.md`, `decisions.md`, `progress.md`, `diary.md` | `.somi/plans/<slug>/`            | Same                                              |
| Phase files                           | `.somi/plans/<slug>/phases/<NN>-*.md`                | Same                                              |
| Review files                          | `.somi/reviews/<slug>/<YYYY-MM-DD>-*.md`             | Same; one per review run                          |
| Findings ledger                       | `.somi/reviews/<slug>/findings.json`                 | Same; machine view of findings (stable `F-<n>` ids, open/fixed lifecycle) |
| `audit.log`                           | `.claude/audit.log`                                  | Append-only across sessions                       |
| Context-injection state               | `.claude/somi-state/last-context-signature`          | Project-local, gitignored                         |
| Loop state                            | `.claude/somi-state/loop/<slug>[.<N>.<M>].json`      | Project-local, gitignored; survives session death (loops resume) |
| Diff                                  | git                                                  | As long as the branch / history is kept           |

All artifacts under `.somi/` should be committed to the repository. They're how the team and
future readers understand what was built and why.

> **Status lives in `progress.md` only.** The phase files describe what each iteration *is*
> (scope, files, acceptance) — never what state it's in. The verbatim user problem statement
> lives in `context.md` only; `spec.md §1` is the agent's restatement; `diary.md` Work-item-started
> points back. This eliminates the drift bait the audit flagged.

## Multiple work items

Each `/plan` creates its own work item. Slugs come from the problem statement; you can pick a
different one when prompted. If you re-invoke `/plan` on the same problem, SoMi asks whether to
continue the existing work item (preserving diary), reset it, or branch into a new slug.

When invoking `/code` or `/review` without a slug, SoMi looks at `.somi/` for a single work
item with `status: in-progress` in its `progress.md` and uses it. If there are multiple, it asks.

## Plan changes during implementation

When the coder discovers something that requires changing the plan (not just the code), it
follows the **plan-change protocol**:

1. Stop the contested work.
2. Update `spec.md`, `phases/<NN>-*.md` (scope/acceptance — not status), and `progress.md`
   (status fields, single source of truth) in place.
3. In `decisions.md`, never edit an accepted entry — supersede it with a new one and mark the old
   one `superseded by D<N>`.
4. If a `brief.md` exists and the superseded decision appears in its §2 "Decisions in force",
   append one line to the brief's **`§10 Supersessions`** section (never rewrite §1–§9 — the brief
   is a cached prompt prefix; the append-only overlay keeps it truthful for later passes).
5. Append a `diary.md` entry (top of file, newest first) with category `plan-change` (or
   `decision-change`, `blocker`) explaining what was discovered and why the plan changed.
6. Surface to you with the revised plan before continuing.

The spec never shows stale state. The diary remembers what changed.

## Project configuration (`.somi/config.json`)

Loop caps and hook policies are configurable **per project** via an optional, committed
`.somi/config.json` — reviewable team policy instead of per-session env-var folklore.
**Precedence: env var (session override) > `.somi/config.json` > SoMi defaults.** All keys are
optional; omit anything you don't want to change:

```json
{
  "code_loop":     { "max_passes": 3, "severity_floor": "Major", "diff_cap_lines": 400, "review_mode": "single" },
  "plan_loop":     { "max_passes": 3, "severity_floor": "Major" },
  "ship_loop":     { "global_budget_passes": 15 },
  "design_loop":   { "max_passes": 2 },
  "discover_loop": { "max_passes": 2 },
  "parallel":      { "max_parallel": 3 },
  "debug":         { "max_hypotheses": 5 },
  "dep_install":   { "allow": ["@types/", "eslint-"] },
  "lockfiles":     { "allow_edit": false }
}
```

- The loop keys map 1:1 to the env vars in each command's gate table
  (`code_loop.max_passes` ↔ `SOMI_CODE_LOOP_MAX_PASSES`, etc.).
- `dep_install.allow` is a list of **package-name prefixes** the `gate-dep-install` hook permits
  without the session-wide `SOMI_ALLOW_DEP_INSTALL=1` — scoped policy (e.g. type stubs) instead
  of an all-or-nothing switch. Conservative by construction: compound commands never qualify,
  and every package in the command must match a prefix.
- `lockfiles.allow_edit: true` permits hand-editing lockfiles as project policy
  (`SOMI_ALLOW_LOCKFILES` still wins for a session, including `=0` to re-deny).

## Dependency additions

Adding a new runtime dependency is a decision. The `gate-dep-install` hook denies
`npm install <pkg>`, `pip install <pkg>`, `cargo add`, etc. unless you've opted in for the
session:

```bash
export SOMI_ALLOW_DEP_INSTALL=1
```

The dep should also be recorded in `decisions.md` (with the agent's case for adding it) or
surfaced in the iteration summary for human sign-off. Bare lockfile-respecting reinstalls
(`npm install` with no args) are always allowed.

## Tips

- **Edit files in `.somi/plans/<slug>/` directly** between stages. They're your artifacts.
- **Use `/review plan <slug>`** for anything you'd send to a human staff engineer for an
  architecture preview.
- **Re-run `/review`** after addressing findings. Verdicts can change — a Blocker fix sometimes
  reveals a new Major.
- **Commit `.somi/`** with the feature branch — the artifact set explains the work to future
  readers.
- **Inspect `audit.log`** if you're curious what tools SoMi touched during a session.
- **`diary.md` is the time machine** — when you come back to a work item in three months, read
  diary first to understand the journey.
