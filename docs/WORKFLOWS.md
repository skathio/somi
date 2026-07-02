# Workflows

SoMi organises Claude's behavior into two **economic tiers**. A **MAX** tier (`opus`) front-loads the
expensive reasoning — research, design, decisions, complexity mapping, fresh-eyes review — into a
dense, bounded **`brief.md`**. An **ECO** tier (`sonnet`) then executes against that brief *without
re-researching*, so the high-volume work (plan detail, iterative coding) runs cheaply.

- **MAX front-loads:** `/discover` (a whole new product), `/design` (a brownfield feature/story), and
  `/refactor` analysis (a large refactor) — each compiles a `brief.md`. `/review` is the MAX
  fresh-eyes judgment.
- **ECO execution:** `/plan` (+ `/plan-loop`) sequences the brief into phases; `/code` (+ `/code-loop`,
  `/code-parallel`) implements against it.

Each workflow has a clean handoff to the next and can be invoked alone (**chunked execution** — run
`/design` today, `/code-loop` next week, each cold-starting from the brief). The whole pipeline can
run together as `/ship` (gated at every stage) or `/ship-loop` (continuous, gated once at the MAX→ECO
model switch). The build workflows produce durable artifacts inside `.somi/plans/<slug>/`; discovery
produces the requirements & design foundation inside `.somi/rd/<slug>/`.

> **Why tier this way.** Previously every agent ran `opus`, spreading the expensive model across the
> whole lifecycle — including the highest-volume work. Concentrating `opus` on the front-loaded brief
> and on review, then running plan/code on `sonnet` against the brief, is the **plan-and-execute /
> model-cascade** pattern: a strong model compiles the context once, a cheaper model executes it many
> times. The `brief.md` is the contract that makes the cheap tier safe — it carries the decisions,
> the complexity map, and an explicit *"what ECO does NOT need to re-research"* list.

## The workflows

```
   (greenfield only)
┌──────────────────────┐
│   DISCOVERY          │
│   /discover          │
│ agent:discovery-     │
│       analyst        │
│ → .somi/rd/<slug>/   │
│  research + BRD/SRS/ │
│  FRD/SDD/TDD         │
└──────────┬───────────┘
           │ requirements + design direction
           ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   PLANNING      │ ───▶ │     CODING      │ ───▶ │   REVIEWING     │
│   /plan         │      │     /code       │      │   /review       │
│   agent:planner │      │   agent:coder   │      │ agent:reviewer  │
│  → .somi/plans/<slug>/│      │   → diff+tests  │      │ → reviews/...md │
│   (6 docs +     │      │  + updates spec/│      │ + updates diary │
│   phases/)      │      │  diary on change│      │ if plan affected│
└─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                                                  │
        │                                                  │
        └──────────────  re-plan if blocker  ──────────────┘
```

> **Discovery is optional and upstream.** It runs once per greenfield initiative to decide *what* to
> build and *whether* it's worth building, then feeds planning. Incremental work with settled
> requirements skips it and starts at `/plan`. See [Discovery](#discovery-pre-development) below.

## Where artifacts live

Plans and reviews live in separate subdirectories to avoid cluttering work-item directories with
review output:

```
.somi/
├── README.md
├── atlas.md                            ← the Repo Atlas (from /atlas) — SHA-stamped repo map
├── config.json                         ← optional committed policy (loop caps, hook allowlists)
├── rd/                                 ← discovery initiatives (pre-development)
│   └── <slug>/
│       ├── README.md                   ← index, status, traceability map
│       ├── research-report.md          ← competition, complaints, failure modes (cited)
│       ├── brd.md                       ← business requirements
│       ├── srs.md                       ← software requirements spec (FR/NFR, canonical)
│       ├── frd.md                       ← functional requirements detail
│       ├── sdd.md                       ← software design (high-level direction)
│       ├── tdd.md                       ← technical design (high-level constraints)
│       ├── decisions.md                ← crossroads resolved with the user
│       ├── brief.md                    ← the MAX→ECO handoff (dense; feeds /plan)
│       └── diary.md                    ← discovery narrative
├── plans/
│   └── <slug>/                         ← one directory per work item
│       ├── brief.md                    ← MAX→ECO handoff (from /design or /refactor analysis)
│       ├── design.md                   ← feature design (from /design — direction + hard parts)
│       ├── context.md                  ← background, surrounding code, constraints
│       ├── spec.md                     ← purpose, requirements, decisions, user story, DoD
│       ├── decisions.md                ← ADR-style log of architectural choices
│       ├── progress.md                 ← single source of truth for status
│       ├── diary.md                    ← chronological narrative of changes and discoveries
│       ├── rca.md                      ← root-cause record (only for /debug work items)
│       └── phases/
│           ├── 01-<slug>.md            ← one file per phase, iterations inside
│           └── …
└── reviews/
    └── <slug>/                         ← reviews scoped to a work item
        ├── findings.json               ← the findings ledger (stable F-<n> ids, lifecycle)
        ├── 2026-05-21-iter-1-1.md
        └── …
```

The `.somi/` directory holds **both current and past work** — work items are not auto-archived.
Status lives in `progress.md`, not in the directory location. Only humans delete from `.somi/`.

## Discovery (pre-development)

**Purpose**: turn a raw software *idea* into a research-grounded, traceable requirements & design
foundation — *before* planning or coding. This is the requirements-engineering and high-level
software-design phase of the SDLC. Its output is the cornerstone the planner consumes.

**Agent**: [`discovery-analyst`](../agents/discovery-analyst.md). Runs on the **most capable model
end-to-end** (the orchestrating `/discover` command is `opus` too, not `sonnet`) because the output
anchors the entire project.

**Input**: a software idea / product concept from the user.

**Output**: the document set under `.somi/rd/<slug>/` — `research-report.md`, `brd.md`, `srs.md`,
`frd.md`, `sdd.md`, `tdd.md`, plus `decisions.md`, `diary.md`, and a `README.md` index with a
**traceability map**. The list is not fixed: the analyst may add a document the project needs (e.g.
a data/privacy doc for a regulated domain) or omit one that would be ceremony — each recorded in
`README.md` with a reason.

**Extensive research, not a summary** — the analyst scans direct and indirect competitors, mines
real user complaints and churn reasons, and surfaces the recurring failure modes of the space so the
new project can design *away* from them. **Every non-obvious claim is cited**; signal (the same
complaint across many independent sources) is distinguished from noise; fabricating a competitor,
statistic, or citation is the cardinal sin. Every finding lands downstream as a requirement, a
non-goal, or a risk.

**User verification at crossroads** — identical to the planner's protocol: present the decision,
offer 2–4 concrete options with specific pros/cons (grounded in the research where possible),
recommend with reason, offer **Other** and **Discover** escape hatches, record in `decisions.md`.
Direction-shaping choices (target persona, scope boundary, build-vs-integrate, expensive-to-reverse
architecture) are never picked silently.

**Design-depth boundary** — discovery owns the *what* (BRD/SRS/FRD) and the architectural
*direction* (high-level SDD/TDD); the planner owns the *detailed* design, file layout, and PR-sized
slices. The SDD/TDD set direction and the expensive-to-reverse calls, then stop — keeping the two
workflows from duplicating or contradicting each other.

**Stops the workflow**: never plans or codes. When the foundation is complete and crossroads are
verified, status in `README.md` becomes `ready-for-planning`.

**Handoff to planning**: explicit. `/plan <slug>` consumes `.somi/rd/<slug>/` — the SRS/FRD as the
requirements source, the SDD/TDD as architectural direction, the research report as risk context.
Planning re-opens a direction only where it genuinely diverges, recording why.

## Design (feature, pre-planning, MAX)

**Purpose**: settle a **brownfield feature or user story's architecture** against the existing
codebase — *before* planning — and compile it into the `brief.md` the ECO tier executes against. It
fills the gap between discovery (a whole new product) and planning (sequencing): the requirement is
clear, but how it should be shaped against *this* repo is not.

**Agent**: [`designer`](../agents/designer.md). Runs on the **most capable model end-to-end** (the
`/design` command is `opus` too, like `/discover`) because its `brief.md` anchors the whole work item.

**Input**: a feature / user story on an existing codebase.

**Output**: `design.md` (the approach + complexity analysis), `decisions.md` (user-verified
architectural choices), **`brief.md`** (the load-bearing MAX→ECO handoff), and `diary.md`, under
`.somi/plans/<slug>/`. The designer reads the codebase deeply, ingests the repo's own instruction
files once (folding conventions into the brief), resolves the expensive-to-reverse calls with the
user (same verification protocol as the planner), and maps the complexity hotspots.

**Design-depth boundary** — design owns the *architectural approach* and the *complexity map*; the
planner owns *sequencing* into phases and PR-sized slices, and the concrete file-level design. Same
seam as discovery↔planning, one level down.

**Stops the workflow**: never plans or codes. **Handoff to planning**: explicit — `/plan <slug>`
consumes `brief.md` as its primary input and sequences it on the ECO tier. For a high-stakes design,
review it in MAX scope first via `/review design <slug>` (fresh context, bounded loop).

> **When to use which front-load.** New product, open requirements → `/discover`. Feature/story on an
> existing repo, design unsettled → `/design`. Large structural untangle → `/refactor` analysis.
> Settled design, just sequence it → straight to `/plan`.

## Planning

**Purpose**: produce deep implementation plans before any code is written.

**Agent**: [`planner`](../agents/planner.md).

**Premise check first.** Before scaffolding a plan, the planner challenges the request itself — false
premise, XY problem (Y asked, X is the real goal), contradictory requirements, or an already-solved
need — and pauses if it doesn't hold. Restating a request is not endorsing it; a faithful plan of the
wrong thing is still wrong. (Discovery does the same at the idea level, where the honest outcome can
be **go / no-go / pivot**.)

**Input**: a problem statement from the user — **or** a discovery foundation at `.somi/rd/<slug>/`
(see [Discovery](#discovery-pre-development)). When a foundation exists, the planner treats the
SRS/FRD as the requirements source and the SDD/TDD as architectural direction rather than
re-deriving them. Discovery is **not a prerequisite**: incremental work proceeds from a problem
statement alone.

**Output**: the six-file artifact set under `.somi/plans/<slug>/` plus phase files. At minimum the
artifacts together capture: problem framing, goals/non-goals, assumptions, unknowns, architecture
sketch, decisions considered (with rejected alternatives carrying reasons), sequenced phases,
PR-sized iteration slices, test strategy, security considerations, observability plan, rollout
& rollback, risk register, definition of done, and open questions.

**User verification on decisions** — every architectural or design decision goes through:
1. Present the decision in plain language.
2. Offer 2–4 concrete options, each with specific (non-vague) pros and cons.
3. Recommend, with reason.
4. Offer **Other** (user proposes a custom option) and **Discover** (guided narrowing questions)
   as escape hatches.
5. Record the choice in `decisions.md` with `Verified with user: yes`.

**Quality bar**: a different engineer should be able to read `spec.md` + `phases/01-*.md` and
start coding **without asking another question**. Decisions are visible and arguable. Risks are
concrete failure modes with concrete mitigations.

**Stops the workflow**: never starts coding. The human must approve.

**Handoff to coding**: explicit. Code references the work-item slug and the phase/iteration being
executed.

## Coding

**Purpose**: implement against an approved plan with senior-level design judgment, keeping the
plan in sync with reality.

**Agent**: [`coder`](../agents/coder.md).

**Input**: a work-item slug + iteration reference (e.g., `phase 1, iteration 1`), or a
self-contained trivial task.

**Output**: a coherent diff + tests + updated docs (when behavior changes) + updates to
`progress.md`, `phases/<NN>-*.md`, and `diary.md` + a summary identifying what changed, what was
not done, what to look at first.

**Plan-change protocol** — if implementation reveals the plan needs to change:
1. Stop the contested work.
2. Update `spec.md`, `decisions.md` (supersede entries; never edit in place), `phases/<NN>-*.md`,
   `progress.md` to reflect the new truth.
3. If a `brief.md` exists and the superseded decision appears in its §2 "Decisions in force",
   append a supersession line to the brief's `§10 Supersessions` (append-only overlay — §1–§9
   are a cached prompt prefix and are never rewritten).
4. Append a diary entry with category `plan-change` / `decision-change` / `blocker`.
5. Surface to the user before continuing.

The plan never shows stale state — including the brief. The diary remembers what changed.

**Quality bar**: tests pass locally (the agent ran them), naming/structure match surrounding code,
no scope drift, no silent compromises, no leftover debug, plan kept in sync if changed.

**Re-plans on scope discovery**: see plan-change protocol above. Coder doesn't silently widen
scope; it surfaces and the user decides.

**Handoff to reviewing**: explicit. The reviewer reads the spec, the diff, recent diary entries,
and the summary.

## Reviewing

**Purpose**: strict, skeptical, evidence-driven review of code, plans, or architectural proposals.

**Agent**: [`reviewer`](../agents/reviewer.md). Calls in
[`security-reviewer`](../agents/security-reviewer.md),
[`architecture-reviewer`](../agents/architecture-reviewer.md), or
[`test-strategist`](../agents/test-strategist.md) when the change matches their territory.

**Input**: a work-item slug (most common), or a diff (working tree, range, PR), a plan, an ADR, or
a file.

**Output**: a review file at `.somi/reviews/<slug>/<YYYY-MM-DD>-<phase>.<iter>-<verdict>.md` with
severity-graded findings (Blocker / Major / Minor / Nit), each with a location, what's wrong, why
it matters, and a suggested fix. Plus a line in `progress.md` "Recent activity" and a diary entry
if findings affect the plan.

**Plan-vs-code checks** (SoMi-specific) — does the diff stay within the iteration scope? Did plan
changes get captured in `decisions.md` and `diary.md`? Is `progress.md` accurate?

**Quality bar**: no rubber-stamping. If the diff is clean, the reviewer says so with evidence
(read X, traced Y). Findings cite specific `file:line` locations. Reject when warranted.

**Handoff back to coding (rework)**:
- **Blocker** — must fix before merge.
- **Major** — should fix; merging without resolution requires explicit human sign-off.
- **Minor** — nice to fix; can be follow-up.
- **Nit** — style/taste, no obligation.

When findings point at the *plan* (not just the code), the reviewer says so and the next `/code`
run applies the plan-change protocol.

**The parallel panel ([`/review-panel`](../commands/review-panel.md))** — for a high-stakes change
that crosses several concerns at once, the panel seats the relevant lenses (`reviewer` plus
`security-reviewer` / `architecture-reviewer` / `test-strategist` as the diff warrants) and runs them
**concurrently** on the same captured diff, then merges and de-duplicates their findings into one
verdict (highest severity wins; lens disagreement is surfaced). It's safe to parallelize because
every lens is read-only — there's no write contention — and the orchestrator owns the single merged
write. Use `/review` for the everyday single-lens pass; reach for `/review-panel` before merging
something that touches auth *and* a new contract *and* the test shape. (On hosts without concurrent
sub-agents, the panel runs the same lenses sequentially.)

---

## Why these three (and not four, or five)

The split tracks the **three reasons engineering work is hard**:
- **Planning** — knowing what to build and in what order.
- **Coding** — executing without introducing new problems.
- **Reviewing** — catching what the executor missed.

These three exist in every engineering team's day; SoMi makes them explicit and gives each one
a specialised agent with a clear quality bar.

**Why discovery is separate, not a fourth daily stage.** Discovery answers a different question than
planning: not "how do we build this and in what order" but "*what* should exist, for whom, and is it
worth building at all" — settled once at the start of a greenfield initiative, grounded in
competitive research, and rarely revisited per change. It has a genuinely different problem shape
(research + requirements engineering vs. implementation sequencing), a different artifact set
(`.somi/rd/` vs. `.somi/plans/`), and a different cadence (per product, not per change). So it earns
its own workflow — but it sits *upstream* of the build trio rather than inside the daily loop.

Support agents (`security-reviewer`, `architecture-reviewer`, `test-strategist`, `refactorer`) are
*facets* of these three, invoked when the work clearly engages their domain. They aren't separate
workflows because they don't have separate problem-shapes; they're depth-on-demand.

## When workflows compose

- **Discover → Plan → Code → Review** for a greenfield product or major new initiative — discovery
  produces the requirements & design foundation (+ `brief.md`), which planning turns into phased work.
- **Design → Plan → Code → Review** for a design-heavy brownfield feature — `/design` (MAX) compiles
  the `brief.md`; `/plan` (ECO) sequences it; `/code-loop` (ECO) implements against it. This is the
  daily MAX→ECO chain for non-trivial features.
- **Plan → Code → Review** is the normal sequence when the design is already settled.
- **Plan → Plan-review → Code → Review** when the plan is high-stakes or high-ambiguity.
- **Code → Review → Code (rework) → Review** when the first review surfaces findings.
- **Plan → Code → Review → Plan-change protocol → Code** when review reveals the plan was wrong,
  not just the code. Spec/decisions/phases get updated in place; diary entry captures why.
- **Refactor (standalone)** when the next planned change requires untangling first; refactor is
  its own mini-cycle that returns the codebase to a state where the planned change is easy.
- **Impact → Design/Plan** when the change's *cost* is the open question —
  [`/impact`](../commands/impact.md) (read-only, atlas-first) maps the blast radius first; its
  report becomes `/design`'s pre-read, tells `/review-panel` which lenses the surface warrants,
  or honestly says "reconsider" with the numbers.
- **Upgrade** for a dependency bump — [`/upgrade`](../commands/upgrade.md): cited
  breaking-change/CVE research (MAX) → usage scan → mini-brief (doubles as the dep-gate
  sign-off) → migration under `/code-loop` (ECO).
- **Release-readiness** before shipping a set of work items —
  [`/release-readiness`](../commands/release-readiness.md): a deterministic checklist over the
  artifacts plus one MAX review of the cumulative integration diff; verdict + draft release notes.
- **Incident (emergency lane)** when production is broken —
  [`/incident`](../commands/incident.md): mitigate fast (hooks stay on), live diary timeline,
  then **mandatory** postmortem + a seeded `/debug` or `/plan` follow-up. The lane exists so
  urgency doesn't mean bypassing SoMi entirely.
- **Adopt** once per existing repo — [`/adopt`](../commands/adopt.md): atlas + confirmed
  conventions into `99-overrides.md` + gap report + a calibration work item.
- **Debug (standalone)** when a bug's cause is not yet isolated — [`/debug`](../commands/debug.md)
  reproduces first (failing test as the non-overridable gate), isolates under a bounded
  hypothesis budget (with a fresh-context MAX diagnosis hatch when narrowing stalls), fixes under
  `/code-loop` with the repro as acceptance, and leaves the repro test as the regression guard
  plus a one-page `rca.md` under `.somi/plans/<slug>/`. If diagnosis reveals a feature-sized fix
  or a wrong architectural decision, it hands off to `/plan` with the RCA as input.
- **Plan → Code-parallel → Review** when a phase has iterations the planner proved **independent**
  (`Parallelizable: yes` with disjoint file sets). [`/code-parallel`](../commands/code-parallel.md)
  builds each in its own git worktree concurrently, then **integrates them one at a time** with tests
  and review at every merge — smaller, more focused per-iteration diffs without the merge-hell tax.
  A merge conflict means the iterations weren't actually independent, so it's surfaced as a planning
  signal, not auto-resolved. The default path stays sequential (`/code-loop`); parallel is opt-in and
  only where proven safe.

## The `/ship` and `/ship-loop` pipelines

`/ship <problem>` runs the full pipeline with **hard gates between every stage** — the careful path.
It's identical to running (an optional MAX front-load, then) `/plan`, then `/code`, then `/review`
manually, with the orchestration baked in.

`/ship-loop <problem>` is the **continuous** path of the MAX→ECO economy: it front-loads a MAX action
once (compiling `brief.md`), gates a **single** human checkpoint **at the MAX→ECO model switch** (you
review the brief), then runs the ECO loops (`/plan-loop` → `/code-loop`) to completion **under bounded
caps** with no per-iteration stop. If you start cold with no MAX front-load, the gate falls to after
`/plan-loop` — the pipeline is never run end-to-end with zero human review. The model switch is the
gate; the caps (per-layer + global budget + cross-layer breaker) are the safety net.

## The Repo Atlas (amortized MAX)

The `brief.md` compresses a *work item*; **`.somi/atlas.md`** (built by
[`/atlas`](../commands/atlas.md), MAX tier) compresses the *repository*: module map, dependency
rules, conventions digest, complexity hotspots, test topology — SHA-stamped. Every later MAX
action (`/design`, a cold `/plan`, `/refactor` analysis, `/impact`) starts from the atlas, runs
its staleness check (`git diff --stat <atlas-SHA>..HEAD`), and deep-reads **only the drift plus
the paths the work touches** — instead of paying a full repo read per work item. On a repo with
regular feature work this is the largest remaining MAX-cost lever, and it makes designs more
consistent (every feature works from the same map). A stale atlas is worse than none: consumers
check before trusting, and structural drift triggers a refresh rather than silent reliance.

## The deterministic loop core (state + findings ledger)

The bounded loops' central promise — *hard* gates — is enforced by code, not by the model
simulating a state machine in context. Two scripts ship with SoMi:

- [`scripts/somi-loop.sh`](../scripts/somi-loop.sh) — per-loop state at
  `.claude/somi-state/loop/<slug>[.<N>.<M>].json` (project-local, gitignored): the baseline SHA
  captured once at init, resolved caps (flag > env > `.somi/config.json` > default), the pass
  counter, and a per-pass history (verdict, Blocker/Major counts, diff size — the run's
  telemetry). `pass` exits `2` past the cap; `check-diff` measures the cumulative weighted diff
  (working tree included, `.somi/`/`.claude/` excluded, out-of-scope files count double) and
  exits `3` over the cap. Because the state is durable, a loop **resumes** after a session dies
  (`resume`) instead of starting over or re-guessing its baseline.
- [`scripts/somi-findings.sh`](../scripts/somi-findings.sh) — the **findings ledger** at
  `.somi/reviews/<slug>/findings.json` (committed; the machine view beside the markdown review
  files). Every review's findings are recorded with a stable id (`F-<n>`) and a stable locus
  (file + symbol + normalized title — never a line number), and carry a lifecycle
  (`open → fixed / accepted / wontfix`). Recurrence is computed mechanically:
  **consecutive-pass recurrence** (exit `5`) is `/code-loop`'s and `/plan-loop`'s circuit
  breaker; **cross-run recurrence** is `/ship-loop`'s cross-layer breaker — and both work across
  sessions, because the ledger is durable. `/review` starts by re-checking the open findings
  instead of starting blind, and `progress.md` follow-ups reference `F-<n>` ids.

The model keeps the judgment — what a finding *is*, what to do when a gate fires; the scripts own
the counting. On hosts without a shell, the loops fall back to the old judgment-enforced
tracking and say so in the summary.

## What SoMi workflows are *not*

- **Not a substitute for human judgment.** The human approves between stages and decides on every
  architectural choice (the agent recommends; the user picks).
- **Not a one-shot.** Each stage is iterative; review feedback flows back into coding; coding can
  flow back into planning.
- **Not silent.** Every stage produces durable artifacts you can read, edit, and reject. The diary
  records when and why the plan shifts.
- **Not destructive of history.** Past work items remain in `.somi/`; superseded decisions stay
  in `decisions.md`; old diary entries are never rewritten.
