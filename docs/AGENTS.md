# Agents

SoMi ships ten agents: nine phase-specific subagents across two **cost tiers**, plus one
Copilot-only front door (`somi`) documented separately in
["The front-door agent"](#the-front-door-agent) below. The **`cost: high`** tier front-loads the
expensive reasoning — research, design, decisions, complexity mapping, and fresh-eyes review — and
compiles it into a dense `brief.md`. The **`cost: medium`** tier executes against that brief without
re-researching. See [Cost tiering](#cost-tiering) below.

| Agent                                                        | Cost           | When                                                                  |
|--------------------------------------------------------------|----------------|-----------------------------------------------------------------------|
| [`discovery-analyst`](../agents/discovery-analyst.md)        | `high`         | New product / greenfield idea, before planning; requirements + research |
| [`designer`](../agents/designer.md)                          | `high`         | Design-heavy feature / user story on an existing codebase, before planning |
| [`refactorer`](../agents/refactorer.md)                      | `high`         | The next change needs untangling first; behavior-preserving structure (surgical), or design a large refactor (analysis) |
| [`reviewer`](../agents/reviewer.md)                          | `high`         | Before merge; whenever you want a skeptical second opinion            |
| [`security-reviewer`](../agents/security-reviewer.md)        | `high`         | Auth, crypto, secrets, input validation, deserialization, file uploads |
| [`architecture-reviewer`](../agents/architecture-reviewer.md)| `high`         | New module/service/contract; dependency direction change              |
| [`test-strategist`](../agents/test-strategist.md)            | `high`         | Test shape feels wrong; deciding unit vs. integration; flake debugging |
| [`planner`](../agents/planner.md)                            | `medium`       | Non-trivial change; sequence the design (brief) into phases           |
| [`coder`](../agents/coder.md)                                | `medium`       | Executing against an approved plan + brief; small, well-scoped tasks  |
| [`somi`](../agents/somi.md)                                   | `medium`       | GitHub Copilot session persona — not phase-specific; classifies the request and dispatches to whichever of the other 9 fits (see "The front-door agent" below) |

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

- **Cost**: `high` — and its `/discover` command runs at `cost: high` too (the one command-layer
  exception; see [COMMANDS.md](./COMMANDS.md)), because the output anchors the whole project.
- **Won't**: plan or code; fabricate research; produce detailed design that competes with the
  planner; cheerlead an idea the research condemns.
- **Will**: stop and hand off to the planner if the idea is already well-specified rather than
  manufacturing ceremonial paperwork; **pressure-test the idea and decide go / no-go / pivot** — a
  cited "don't build this" memo is a valid, first-class outcome, not a failure to deliver documents.

Invoke directly via `/discover`. Optional and upstream — incremental work with settled requirements
goes straight to `/plan`.

### designer

Feature / user-story design at **`cost: high`**, against an **existing codebase**. Fills the gap
between `discovery-analyst` (a whole new product) and `planner` (sequencing): when a requirement is
clear but the architecture against this repo is not, the designer reads the codebase deeply, resolves
the expensive-to-reverse decisions with the user (same verification protocol as the planner), maps
the complexity hotspots, and compiles a dense [`brief.md`](../templates/BRIEF.md.tmpl) plus a
`design.md`. That brief is the load-bearing output — it lets the medium-cost planner/coder execute
**without re-deriving the architecture**.

- **Cost**: `high` — and its `/design` command runs at `cost: high` end-to-end (like `/discover`),
  because the brief anchors everything downstream.
- **Won't**: plan or code; produce file-by-file design (that's the planner); pick architecture
  silently; emit a bloated brief or an empty "what execution need not re-research" section.
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

- **Cost**: `medium` — planning is *sequencing an already-compiled design*, not
  open-ended research. When a design action ran upstream, the planner consumes its `brief.md` and
  slices it into phases. For a cold, design-heavy plan with no brief, the planner runs a **depth
  gate** and recommends `/design` (`cost: high`) first. Overridable to `cost: high` in the agent
  frontmatter.
- **Won't**: write code, silently pick architectural defaults, take the request's framing as truth.
- **Will**: stop and recommend re-scoping if the work is much larger than presented; **challenge the
  request's premise** (false premise, XY problem, contradiction, already-solved need) before planning
  and pause if it doesn't hold.

### coder

Elite implementation. Executes against the plan with senior-level design judgment. Updates
`progress.md`, the phase file, and `diary.md` as it works. Follows the **plan-change protocol**
when implementation reveals the plan needs changing: updates spec/decisions/phases in place,
appends a diary entry, surfaces to the user before continuing.

- **Cost**: `medium` — coding executes against the plan + `brief.md`, where the
  architecture/decisions/complexity/repo-conventions were already settled by a `cost: high` action.
  The plan-change protocol (judgment, not research) still applies. Overridable to `cost: high` in
  frontmatter.
- **Won't**: silently widen scope; ship without running tests; bypass hooks; let the plan show
  stale state.
- **Will**: stop and trigger the plan-change protocol if the planned approach is producing bad
  code or hits an unforeseen constraint.

### reviewer

Strict, skeptical, evidence-driven. Reviews code, plans (the `.somi/plans/<slug>/` artifact set), or
architectural proposals. Checks plan-vs-code alignment: did the diff stay within scope, did
changes get captured in `decisions.md` and `diary.md`, is `progress.md` accurate.
Severity-graded findings, will reject weak solutions.

- **Cost**: `high`.
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

- **Cost**: `high`.
- **Canonical knowledge**: the [`owasp-defense`](../skills/owasp-defense/SKILL.md) and
  [`threat-modeling`](../skills/threat-modeling/SKILL.md) skills — on a technique divergence, the
  skill wins. The agent owns the actor role (when/how to trace, what to produce).

### architecture-reviewer

Structural decisions — new module/service, dependency direction, public-contract introduction,
ADR review. Time horizon is years; reversibility is a first-class concern.

Invoke directly via `/architecture-review`, or via `/review` when the change introduces a
contract/module/service (the consultant-trigger table auto-invokes).

- **Cost**: `high`.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`api-design`](../skills/api-design/SKILL.md) skills — skill wins on divergence.

### test-strategist

Decides what to test, at what level, and how. Distinguishes risk-driven coverage from
coverage-worship. Identifies when the test shape is a *design* problem.

Invoke directly via `/test-strategy`, or via `/review` when the diff has mock-heavy / flaky /
e2e-only-on-risky-code symptoms.

- **Cost**: `high`.
- **Canonical knowledge**: the [`testing-playbook`](../skills/testing-playbook/SKILL.md) skill — skill wins
  on divergence.

### refactorer

Surgical, behavior-preserving structure changes. Tests stay green at every step. No feature work
mixed in. Returns the codebase to a state where the next planned change is easy.

- **Cost**: `high`.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`clean-code`](../skills/clean-code/SKILL.md) skills — skill wins on divergence.

## The front-door agent

### somi

A Copilot-only dispatcher, not a phase-specific agent. Selecting it as the session persona
removes the "which of the other 9 do I need?" choice: per incoming message it runs an
invocation-mode gate first — an explicit non-`/somi` command is proxied directly, an explicit
`/somi` passes through to the `/somi` command verbatim, and anything else is classified against
[`skills/somi-routing/SKILL.md`](../skills/somi-routing/SKILL.md) and carried inline
(adopt-inline — no sub-agent `Task`, since Copilot has none). High-cost flows (`/design`,
`/discover`, `/atlas`) are routed to their direct command rather than adopted under this agent's
own `cost: medium` tier.

- **Cost**: `medium` — a thin dispatcher; high-cost flows are routed to, not adopted under, this
  tier.
- **Won't**: second-guess an explicit command; wrap a second opinion around `/somi`'s own
  recommendation; adopt a high-cost persona inline; emit a sub-agent `Task` (Copilot has none).
- **Will**: announce which flow it's entering and why before adopting it; keep the dispatched
  flow's own verification gates intact; nudge Claude Code users toward the direct commands,
  where this agent adds no value (the direct commands already pick the right agent there).

Invoke by selecting `somi` as your Copilot agent. Not needed on Claude Code.

**`somi` the agent vs. `/somi` the command.** The token names two surfaces, disambiguated by
kind: the **agent** (`agents/somi.md`) is what a Copilot user *selects* to drive a session; the
**`/somi` command** (`commands/somi.md`) is the read-only status-dashboard-and-router *invoked
inside* a session on either host (`@somi /somi`). They coexist deliberately — see
[`docs/PLUGIN.md`](./PLUGIN.md#github-copilot-extension) for how a Copilot session uses both.

## Cost tiering

SoMi tiers models by **SDLC phase**, not by orchestration depth. The expensive model is spent once,
up front, to compile a dense handoff; the cheap model does the high-volume execution against it.
See [`scripts/lib/cost-model.mjs`](../scripts/lib/cost-model.mjs) for the current `cost` → model
mapping per host — this doc names the tier, not the model, so a repricing or a new model stays a
one-file change.

| `cost` | Agents | What it does |
|------|--------|--------------|
| **`high`** | `discovery-analyst`, `designer`, `refactorer`, `reviewer`, `security-reviewer`, `architecture-reviewer`, `test-strategist` | Front-loads research, design, decisions, and complexity mapping into a `brief.md`; and provides fresh-eyes review |
| **`medium`** | `planner`, `coder` | Sequences and implements **against** the brief, without re-researching |

The handoff is the [`brief.md`](../templates/BRIEF.md.tmpl) (`templates/BRIEF.md.tmpl`): a dense,
bounded, reference-not-inline distillation with an explicit **"What execution does NOT need to
re-research"** section. The `cost: high` pass writes it; `cost: medium` execution consumes it. This
is the **plan-and-execute / model-cascade** pattern (strong planner, cheap executor).

**Why this saves spend without losing quality.** Previously every agent ran at the top cost tier,
spreading the expensive model across the whole lifecycle — including the highest-volume work
(iterative coding, plan detail). Now the expensive model concentrates where it pays off: (a) the
front-loaded brief, and (b) fresh-eyes review. The bulk token volume — sequencing and iterating —
runs at `cost: medium`, fed by the brief. The agent's resolved model is overridable per project in
the agent frontmatter and the per-host mapping.

**Orchestrator/agent cost and the prompt cache.** Commands (orchestrators) still run at
`cost: medium` and `Task` their agents. A single-cost orchestrator that Tasks a differently-costed
subagent is the cache-correct way to mix costs — the orchestrator's prompt cache stays intact while
the subagent runs on its own tier. (Prompt caches are model-scoped, so the design→execution switch
is also a natural cache boundary.) **`/discover`, `/design`, and `/atlas` run at `cost: high` at
the command layer too** — `/discover` and `/design`'s orchestration is judgment-heavy and their
`brief.md` anchors the whole work item, so they don't split the orchestrator and agent across
tiers; `/atlas` has no paired agent at all — the command itself does the deep repo read, so it is
high-cost end-to-end by construction, not by a deliberate exception. See
[COMMANDS.md](./COMMANDS.md).

## Adding new agents

See [EXTENDING.md](./EXTENDING.md). The short version:

1. Add `agents/<name>.md` with proper frontmatter (`name`, `description`, `model`). Omit `tools:` —
   SoMi's agents are trusted with full tool access by design, and review-type agents are constrained
   by a **`## Write discipline` contract in their own prompt** rather than by platform restriction
   (all four review-type agents carry that section). This is a
   deliberate simplicity choice, **not** a compatibility necessity: both hosts support the field
   (Copilot documents `tools` and ignores unrecognized tool names rather than erroring; Claude Code
   supports it too). Escalating to a declared `tools:` is therefore a known-safe move if the
   contract ever proves insufficient. (Copilot's custom-agent reference documents the `tools`
   property and states unrecognized tool names are ignored:
   <https://docs.github.com/en/copilot/reference/custom-agents-configuration>.)
2. Document it in this file with a one-row entry.
3. Open a PR — CI validates the frontmatter.

## Escalation matrix (which command/agent calls which)

Agents themselves cannot Task other agents. Escalations are surfaced as **recommendations** to
the calling command, which decides whether to Task the next agent. `/review` is the structural
entrypoint that auto-invokes consultants (security-reviewer, architecture-reviewer,
test-strategist) based on the trigger table in [`commands/review.md`](../commands/review.md) — so
plain prose escalations from inside an agent are no longer the only path.

```
# cost: high — front-load reasoning into brief.md
/discover    → discovery-analyst (writes .somi/rd/<slug>/ + brief.md; feeds /plan — greenfield only)
/design      → designer         (writes .somi/plans/<slug>/{design.md,brief.md}; feeds /plan — brownfield feature)
/atlas       → (no agent — the high-cost command reads the repo itself; writes .somi/atlas.md, which
                /design, cold /plan, /refactor analysis, and /impact consume instead of re-reading)

# cost: medium — execute against the brief
/plan        → planner         (writes .somi/plans/<slug>/; consumes brief.md / .somi/rd/<slug>/ if present)
/code        → coder           (handoff from planner: spec + active iteration + brief)
/debug       → coder           (repro-gated diagnose→isolate→fix; reviewer Tasked as a fresh-context
                                high-cost diagnosis hatch when isolation stalls; fix runs under /code-loop)
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

/ship        → [optional cost: high front-load] → /plan + (per iteration) /code-loop  (human gate at every stage)
/plan-loop   → planner + reviewer  (bounded plan↔review loop, cost: medium planner + cost: high reviewer)
/ship-loop   → [optional cost: high front-load] → [gate at design→execution switch] → /plan-loop → /code-loop (continuous, under caps)

# Lifecycle & utility commands
/upgrade     → discovery-analyst (cited changelog/CVE research) + /code-loop (migration)
/release-readiness → reviewer   (ONE high-cost integration pass; the checklist itself is deterministic)
/incident    → (mitigation inline, hooks stay on; seeds /debug or /plan as the mandatory follow-up)
/impact      → (no agent — read-only blast-radius tracing, atlas-first)
/adopt       → /atlas flow (+ test-strategist for gap-report depth)
# Note: `somi` also names a selectable Copilot agent persona (agents/somi.md) — not invoked
# via a command, so it has no row of its own here. See "The front-door agent" section above.
/somi        → (no agent — read-only status dashboard & router; this is the /somi command)
/pr          → (no agent — composes the PR from artifacts; gh only after confirmation)

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

**Mechanics — the batch round-trip.** A Tasked subagent cannot pause mid-run to converse with the
user, so the protocol is a round-trip owned by the calling command: the agent's **research pass**
returns a `DECISIONS-NEEDED` block (options, pros/cons, recommendation, plus pre-supplied
narrowing questions that power Discover mode); the command presents each decision to the user and
re-invokes the agent in **authoring mode** with a `VERIFIED-DECISIONS` block appended (append-only,
so the stable briefing prefix stays cache-warm). Only then are decisions recorded with
`Verified with user: yes` — an agent never marks a decision user-verified in the same pass that
generated it. The same mechanics apply to `designer` and `discovery-analyst`.

See [`agents/planner.md`](../agents/planner.md) for the full protocol, the block shapes, and examples.
