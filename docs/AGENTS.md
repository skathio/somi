# Agents

SoMi ships nine subagents across two **economic tiers**. The **MAX** tier (`opus`) front-loads the
expensive reasoning — research, design, decisions, complexity mapping, and fresh-eyes review — and
compiles it into a dense `brief.md`. The **ECO** tier (`sonnet`) executes against that brief without
re-researching. See [Economic tiering](#economic-tiering-maxeco) below.

| Agent                                                        | Tier (model)   | When                                                                  |
|--------------------------------------------------------------|----------------|-----------------------------------------------------------------------|
| [`discovery-analyst`](../agents/discovery-analyst.md)        | MAX (`opus`)   | New product / greenfield idea, before planning; requirements + research |
| [`designer`](../agents/designer.md)                          | MAX (`opus`)   | Design-heavy feature / user story on an existing codebase, before planning |
| [`refactorer`](../agents/refactorer.md)                      | MAX (`opus`)   | The next change needs untangling first; behavior-preserving structure (surgical), or design a large refactor (analysis) |
| [`reviewer`](../agents/reviewer.md)                          | MAX (`opus`)   | Before merge; whenever you want a skeptical second opinion            |
| [`security-reviewer`](../agents/security-reviewer.md)        | MAX (`opus`)   | Auth, crypto, secrets, input validation, deserialization, file uploads |
| [`architecture-reviewer`](../agents/architecture-reviewer.md)| MAX (`opus`)   | New module/service/contract; dependency direction change              |
| [`test-strategist`](../agents/test-strategist.md)            | MAX (`opus`)   | Test shape feels wrong; deciding unit vs. integration; flake debugging |
| [`planner`](../agents/planner.md)                            | ECO (`sonnet`) | Non-trivial change; sequence the design (brief) into phases           |
| [`coder`](../agents/coder.md)                                | ECO (`sonnet`) | Executing against an approved plan + brief; small, well-scoped tasks  |

## How agents get invoked

Three paths:

1. **User invokes a command** (`/plan`, `/code`, `/review`) → command calls the corresponding
   core agent.
2. **A core agent escalates** during its work — e.g., coder hits auth code and asks whether to
   consult `security-reviewer`.
3. **User invokes a specialised command** (`/security-review`, `/architecture-review`,
   `/test-strategy`, `/refactor`) which directly targets a support agent. (Plan-level review
   uses `/review plan <slug>` — there is no separate `/plan-review`.)

SoMi prefers **explicit handoff** over silent specialisation. When a core agent thinks a
support agent should be consulted, it surfaces the recommendation; the human (or the
orchestrating command) decides.

## The discovery agent

### discovery-analyst

Pre-development requirements engineering + competitive research + high-level software design, rolled
into one. Turns a raw idea into the `.somi/rd/<slug>/` document set (research report, BRD, SRS, FRD,
SDD, TDD) with full traceability — every requirement traces to a business goal and a research
finding. Pauses for **user verification** on every requirement- or direction-shaping decision, with
the same options/pros-cons/recommend/`Other`/`Discover` protocol as the planner. Researches the
competition and mines real user complaints to design *away* from known failure modes; cites every
non-obvious claim and never fabricates. Respects the **design-depth boundary**: sets architectural
*direction* (high-level SDD/TDD) and hands *detailed* design to the planner.

- **Model**: `opus` — and its `/discover` command runs `opus` too (the one command-layer exception;
  see [COMMANDS.md](./COMMANDS.md)), because the output anchors the whole project.
- **Won't**: plan or code; fabricate research; produce detailed design that competes with the
  planner; cheerlead an idea the research condemns.
- **Will**: stop and hand off to the planner if the idea is already well-specified rather than
  manufacturing ceremonial paperwork; **pressure-test the idea and decide go / no-go / pivot** — a
  cited "don't build this" memo is a valid, first-class outcome, not a failure to deliver documents.

Invoke directly via `/discover`. Optional and upstream — incremental work with settled requirements
goes straight to `/plan`.

### designer

Feature / user-story design at the **MAX** tier, against an **existing codebase**. Fills the gap
between `discovery-analyst` (a whole new product) and `planner` (sequencing): when a requirement is
clear but the architecture against this repo is not, the designer reads the codebase deeply, resolves
the expensive-to-reverse decisions with the user (same verification protocol as the planner), maps
the complexity hotspots, and compiles a dense [`brief.md`](../templates/BRIEF.md.tmpl) plus a
`design.md`. That brief is the load-bearing output — it lets the ECO planner/coder execute **without
re-deriving the architecture**.

- **Model**: `opus` — and its `/design` command runs `opus` end-to-end (like `/discover`), because
  the brief anchors everything downstream.
- **Won't**: plan or code; produce file-by-file design (that's the planner); pick architecture
  silently; emit a bloated brief or an empty "what ECO need not re-research" section.
- **Will**: ingest the repo's own instruction files once and distil them into the brief; hand off to
  `/plan` with an explicit handoff line; hand back to the planner if the design is trivial.

Invoke directly via `/design`. Use *before* `/plan` when the architecture isn't settled.

## The build agents

### planner

Staff-engineer-grade planning. Produces the `.somi/plans/<slug>/` artifact set (context, spec,
decisions, progress, diary, phases). Pauses for **user verification** on every architectural or
design decision: presents 2–4 concrete options with explicit pros and cons (no vague phrasings),
recommends one, and offers `Other` (user-proposed option) plus `Discover` (guided narrowing
questions) as escape hatches.

- **Model**: `sonnet` (**ECO tier**) — planning is *sequencing an already-compiled design*, not
  open-ended research. When a MAX action ran upstream, the planner consumes its `brief.md` and slices
  it into phases. For a cold, design-heavy plan with no brief, the planner runs a **depth gate** and
  recommends `/design` (MAX) first. Overridable to `opus` in the agent frontmatter.
- **Won't**: write code, silently pick architectural defaults, take the request's framing as truth.
- **Will**: stop and recommend re-scoping if the work is much larger than presented; **challenge the
  request's premise** (false premise, XY problem, contradiction, already-solved need) before planning
  and pause if it doesn't hold.

### coder

Elite implementation. Executes against the plan with senior-level design judgment. Updates
`progress.md`, the phase file, and `diary.md` as it works. Follows the **plan-change protocol**
when implementation reveals the plan needs changing: updates spec/decisions/phases in place,
appends a diary entry, surfaces to the user before continuing.

- **Model**: `sonnet` (**ECO tier**) — coding executes against the plan + `brief.md`, where the
  architecture/decisions/complexity/repo-conventions were already settled by a MAX action. The
  plan-change protocol (judgment, not research) still applies. Overridable to `opus` in frontmatter.
- **Won't**: silently widen scope; ship without running tests; bypass hooks; let the plan show
  stale state.
- **Will**: stop and trigger the plan-change protocol if the planned approach is producing bad
  code or hits an unforeseen constraint.

### reviewer

Strict, skeptical, evidence-driven. Reviews code, plans (the `.somi/plans/<slug>/` artifact set), or
architectural proposals. Checks plan-vs-code alignment: did the diff stay within scope, did
changes get captured in `decisions.md` and `diary.md`, is `progress.md` accurate.
Severity-graded findings, will reject weak solutions.

- **Model**: `opus`.
- **Won't**: rubber-stamp; bury Blockers under Nits; review the author instead of the code; read the
  full accumulated artifact history when a bounded slice suffices (live decisions, active phase,
  recent diary entries).
- **Will**: call in support agents when the change matches their territory (via separate Task
  calls); return a proposed `review-feedback` diary entry when a finding surfaces a plan issue. Can
  run as a **parallel panel** via [`/review-panel`](./COMMANDS.md) — the relevant lenses review the
  same diff concurrently and their findings are merged into one verdict.

## The support quartet

### security-reviewer

OWASP-Top-10-lens audit. Trust-boundary-to-sink walks. Findings include **attack paths** in plain
language (preconditions, what gets executed, what the attacker gains), not just CVE-name dropping.

Invoke directly via `/security-review`, or via `/review` on a diff that touches sensitive
territory (the reviewer auto-invokes when the consultant-trigger table fires).

- **Model**: `opus`.
- **Canonical knowledge**: the [`owasp-defense`](../skills/owasp-defense/SKILL.md) and
  [`threat-modeling`](../skills/threat-modeling/SKILL.md) skills — on a technique divergence, the
  skill wins. The agent owns the actor role (when/how to trace, what to produce).

### architecture-reviewer

Structural decisions — new module/service, dependency direction, public-contract introduction,
ADR review. Time horizon is years; reversibility is a first-class concern.

Invoke directly via `/architecture-review`, or via `/review` when the change introduces a
contract/module/service (the consultant-trigger table auto-invokes).

- **Model**: `opus`.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`api-design`](../skills/api-design/SKILL.md) skills — skill wins on divergence.

### test-strategist

Decides what to test, at what level, and how. Distinguishes risk-driven coverage from
coverage-worship. Identifies when the test shape is a *design* problem.

Invoke directly via `/test-strategy`, or via `/review` when the diff has mock-heavy / flaky /
e2e-only-on-risky-code symptoms.

- **Model**: `opus`.
- **Canonical knowledge**: the [`test-strategy`](../skills/test-strategy/SKILL.md) skill — skill wins
  on divergence.

### refactorer

Surgical, behavior-preserving structure changes. Tests stay green at every step. No feature work
mixed in. Returns the codebase to a state where the next planned change is easy.

- **Model**: `opus`.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`clean-code`](../skills/clean-code/SKILL.md) skills — skill wins on divergence.

## Economic tiering (MAX/ECO)

SoMi tiers models by **SDLC phase**, not by orchestration depth. The expensive model is spent once,
up front, to compile a dense handoff; the cheap model does the high-volume execution against it.

| Tier | Model | Agents | What it does |
|------|-------|--------|--------------|
| **MAX** | `opus` | `discovery-analyst`, `designer`, `refactorer`, `reviewer`, `security-reviewer`, `architecture-reviewer`, `test-strategist` | Front-loads research, design, decisions, and complexity mapping into a `brief.md`; and provides fresh-eyes review |
| **ECO** | `sonnet` | `planner`, `coder` | Sequences and implements **against** the brief, without re-researching |

The handoff is the [`brief.md`](../templates/BRIEF.md.tmpl) (`templates/BRIEF.md.tmpl`): a dense,
bounded, reference-not-inline distillation with an explicit **"What ECO does NOT need to
re-research"** section. MAX writes it; ECO consumes it. This is the
**plan-and-execute / model-cascade** pattern (strong planner, cheap executor).

**Why this saves spend without losing quality.** Previously every agent ran `opus`, spreading the
expensive model across the whole lifecycle — including the highest-volume work (iterative coding,
plan detail). Now `opus` concentrates where it pays off: (a) the front-loaded brief, and (b)
fresh-eyes review. The bulk token volume — sequencing and iterating — runs on `sonnet`, fed by the
brief. The agent model is overridable per project in the agent frontmatter.

**Orchestrator/agent model and the prompt cache.** Commands (orchestrators) still run `sonnet` and
`Task` their agents. A single-model orchestrator that Tasks a differently-modeled subagent is the
cache-correct way to mix models — the orchestrator's prompt cache stays intact while the subagent
runs on its own tier. (Prompt caches are model-scoped, so the MAX→ECO switch is also a natural cache
boundary.) **`/discover` and `/design` run `opus` at the command layer too** — their orchestration is
judgment-heavy and their `brief.md` anchors the whole work item, so they don't split
`sonnet`-orchestrator / `opus`-agent. See [COMMANDS.md](./COMMANDS.md).

## Adding new agents

See [EXTENDING.md](./EXTENDING.md). The short version:

1. Add `agents/<name>.md` with proper frontmatter (`name`, `description`, `model`). Omit `tools:` — leave it unrestricted for cross-runtime compatibility.
2. Document it in this file with a one-row entry.
3. Open a PR — CI validates the frontmatter.

## Escalation matrix (which command/agent calls which)

Agents themselves cannot Task other agents. Escalations are surfaced as **recommendations** to
the calling command, which decides whether to Task the next agent. `/review` is the structural
entrypoint that auto-invokes consultants (security-reviewer, architecture-reviewer,
test-strategist) based on the trigger table in [`commands/review.md`](../commands/review.md) — so
plain prose escalations from inside an agent are no longer the only path.

```
# MAX tier (opus) — front-load reasoning into brief.md
/discover    → discovery-analyst (writes .somi/rd/<slug>/ + brief.md; feeds /plan — greenfield only)
/design      → designer         (writes .somi/plans/<slug>/{design.md,brief.md}; feeds /plan — brownfield feature)

# ECO tier (sonnet) — execute against the brief
/plan        → planner         (writes .somi/plans/<slug>/; consumes brief.md / .somi/rd/<slug>/ if present)
/code        → coder           (handoff from planner: spec + active iteration + brief)
/code-loop   → coder + reviewer (bounded code↔review loop, single iteration; reviewer may be /review-panel)
/code-parallel → per eligible iteration: /code-loop in an isolated worktree, then sequential gated integration
/review      → reviewer        (and auto-invokes consultants per trigger table)
             → security-reviewer       (when sensitive territory)
             → architecture-reviewer   (when introducing structure / contract change)
             → test-strategist         (when test shape is unclear)
/review-panel → reviewer + security-reviewer + architecture-reviewer + test-strategist
             (seated by relevance, run concurrently, findings merged into one verdict)
/security-review     → security-reviewer
/architecture-review → architecture-reviewer (+ security-reviewer if security implications)
/test-strategy       → test-strategist
/refactor    → refactorer

/ship        → [optional MAX front-load] → /plan + (per iteration) /code-loop  (human gate at every stage)
/plan-loop   → planner + reviewer  (bounded plan↔review loop, ECO planner + MAX reviewer)
/ship-loop   → [optional MAX front-load] → [gate at MAX→ECO switch] → /plan-loop → /code-loop (continuous, under caps)

# Within a code workflow:
coder        → plan-change protocol  (when plan needs revising; updates spec/decisions/phases)
reviewer     → review-feedback diary entry  (when finding points at plan, not code)
```

## User verification protocol (planner-specific)

The planner has a **mandatory** verification protocol for any architectural or design decision
that shapes the spec:

1. **State the decision** in plain language.
2. **Offer 2–4 concrete options**, each with **specific pros and cons** (no vague phrasings —
   if you can't name concrete consequences, the option doesn't go on the list).
3. **Recommend** one with a one-or-two-sentence reason.
4. Offer **`Other`** (user proposes a different option) and **`Discover`** (agent asks narrowing
   questions to guide the choice) in every verification prompt.
5. Record the chosen option in `decisions.md` with `Verified with user: yes` and a one-liner in
   `spec.md` §5 (Core decisions).

Decisions changed mid-workflow are **never edited in place** — they're superseded by a new entry,
the old one stays marked `superseded by D<N>`, and a diary entry records the change.

See [`agents/planner.md`](../agents/planner.md) for the full protocol and examples.
