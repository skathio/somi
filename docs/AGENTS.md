# Agents

SoMi ships phase-specific subagents graded across **cost tiers**, plus one Copilot-only front
door (`somi`) documented separately in
["The front-door agent"](#the-front-door-agent) below. The **`cost: high`** tier front-loads the
expensive reasoning — research, design, decisions, complexity mapping, and fresh-eyes review — and
compiles it into a dense `brief.md`. The **`cost: medium`** tier executes against that brief without
re-researching. See [Cost tiering](#cost-tiering) below.

| Agent                                                        | Cost           | When                                                                  |
|--------------------------------------------------------------|----------------|-----------------------------------------------------------------------|
| [`discovery-analyst`](../agents/discovery-analyst.md)        | `high`         | New product / greenfield idea, before planning; requirements + research |
| [`designer`](../agents/designer.md)                          | `high`         | Design-heavy feature / user story on an existing codebase, before planning |
| [`atlas`](../agents/atlas.md)                                | `high`         | Build or refresh the repo-level map (`.somi/atlas.md`) that later design actions read first |
| [`refactorer`](../agents/refactorer.md)                      | `low, medium`  | The next change needs untangling first, contained to one safe behavior-preserving diff |
| [`refactor-designer`](../agents/refactor-designer.md)        | `high`         | The untangle spans many modules / needs a migration — too big for one diff; designs scope + brief |
| [`reviewer`](../agents/reviewer.md)                          | `medium, high` | Before merge; whenever you want a skeptical second opinion            |
| [`security-reviewer`](../agents/security-reviewer.md)        | `high`         | Auth, crypto, secrets, input validation, deserialization, file uploads |
| [`architecture-reviewer`](../agents/architecture-reviewer.md)| `medium, high` | New module/service/contract; dependency direction change              |
| [`plan-reviewer`](../agents/plan-reviewer.md)                | `medium, high` | An independent read of a plan, brief, or ADR before it is approved or executed |
| [`sdlc-reviewer`](../agents/sdlc-reviewer.md)                | `medium, high` | Audit that progress, diary, decisions, and findings match the repository |
| [`test-strategist`](../agents/test-strategist.md)            | `medium, high` | Test shape feels wrong; deciding unit vs. integration; flake debugging |
| [`planner`](../agents/planner.md)                            | `low, medium`  | Non-trivial change; sequence the design (brief) into phases           |
| [`coder`](../agents/coder.md)                                | `low, medium`  | Executing against an approved plan + brief; small, well-scoped tasks  |
| [`impact`](../agents/impact.md)                              | `medium`       | Blast-radius mapping before committing to `/design` or `/plan`; lens selection for a diff |
| [`pr`](../agents/pr.md)                                       | `low, medium`  | Compose a PR title + description from a work item's artifacts         |
| [`incident`](../agents/incident.md)                          | `medium`       | Mitigate + mandatory debt capture once an incident is framed          |
| [`somi`](../agents/somi.md)                                   | none           | GitHub Copilot session persona — not phase-specific; classifies the request and dispatches to whichever of the others fits (see "The front-door agent" below) |

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

Whichever path starts the agent — a command Tasking it directly, or the `somi` front door running
that command's procedure live — the same [`skills/somi-dispatch`](../skills/somi-dispatch/SKILL.md)
procedure is what resolves its cost tier and model against the session ceiling. This is a
prompt-level instruction, not code that runs the resolution deterministically; what
`scripts/validate.sh` mechanically checks is narrower — that every command whose text starts a real
agent references the skill somewhere in its own text, failing the build otherwise.

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

- **Cost**: `high` — no lower member. `/discover` declares no `cost:` of its own (a command has no
  model to size) and Tasks this agent for the judgment-heavy core of the work — the output anchors
  the whole project. The command itself still scaffolds `.somi/rd/<slug>/` and owns the crossroads
  conversation with the user (a Tasked run can't pause mid-flight to converse), which is real work
  with no `cost:` of its own to declare.
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

- **Cost**: `high` — no lower member. `/design` declares no `cost:` of its own (like `/discover`)
  and Tasks this agent for the judgment-heavy core of the work — the brief anchors everything
  downstream. The command itself still scaffolds the artifact set and owns the crossroads
  conversation with the user, for the same reason as `/discover`'s.
- **Won't**: plan or code; produce file-by-file design (that's the planner); pick architecture
  silently; emit a bloated brief or an empty "what execution need not re-research" section.
- **Will**: ingest the repo's own instruction files once and distil them into the brief; hand off to
  `/plan` with an explicit handoff line; hand back to the planner if the design is trivial.

Invoke directly via `/design`. Use *before* `/plan` when the architecture isn't settled.

### atlas

One deep read of the whole repository, distilled into **`.somi/atlas.md`** (module map, dependency
rules, conventions digest, hotspots, test topology) — the repo-level counterpart to `brief.md`:
`brief.md` compresses a work item, the atlas compresses the repository. Paid once, amortized by
every later design-time read: `/design`, a cold `/plan`, `/refactor-design`, and `/impact` all read
it first and deep-read only the drift since its stamped SHA.

- **Cost**: `high` — no lower member. The whole value is one high-quality read of the repository;
  a shallower pass produces a map later consumers trust without earning that trust.
- **Won't**: edit anything outside `.somi/atlas.md` (and `.somi/README.md` if missing); describe
  the intended architecture instead of the one actually in the code.
- **Will**: run its own staleness check (`git diff --stat` against its stamped SHA) and refresh
  only the drifted sections rather than rebuild from scratch on small drift.

Invoke directly via `/atlas`, or as `/adopt`'s Stage 1.

## The build agents

### planner

Staff-engineer-grade planning. Produces the `.somi/plans/<slug>/` artifact set (context, spec,
decisions, progress, diary, phases). Pauses for **user verification** on every architectural or
design decision: presents 2–4 concrete options with explicit pros and cons (no vague phrasings),
recommends one, and offers `Other` (user-proposed option) plus `Discover` (guided narrowing
questions) as escape hatches.

- **Cost**: `low, medium` — planning is *sequencing an already-compiled design*, not
  open-ended research. When a design action ran upstream, the planner consumes its `brief.md` and
  slices it into phases. For a cold, design-heavy plan with no brief, the planner runs a **depth
  gate** and recommends `/design` (Tasks `designer` at `cost: high`) first. `low` still produces
  the full artifact set (and still keeps the false-premise/contradiction checks, the depth gate,
  and `Pros`/`Cons`/`Reverses` on the recommended option) but trims the alternatives comparison and
  Discovery mode's guided flow — selected whenever the session ceiling resolves to `low` (CLI,
  `SOMI_COST_CEILING`, a committed `.somi/config.json`, or persisted state), with the ceiling and
  its source announced before the first agent it applies to starts, on every entry path (see
  [`skills/somi-dispatch`](../skills/somi-dispatch/SKILL.md)). Overridable to `cost: high` in the
  agent frontmatter.
- **Won't**: write code, silently pick architectural defaults, take the request's framing as truth.
- **Will**: stop and recommend re-scoping if the work is much larger than presented; **challenge the
  request's premise** (false premise, XY problem, contradiction, already-solved need) before planning
  and pause if it doesn't hold.

### coder

Elite implementation. Executes against the plan with senior-level design judgment. Updates
`progress.md`, the phase file, and `diary.md` as it works. Follows the **plan-change protocol**
when implementation reveals the plan needs changing: updates spec/decisions/phases in place,
appends a diary entry, surfaces to the user before continuing.

- **Cost**: `low, medium` — coding executes against the plan + `brief.md`, where the
  architecture/decisions/complexity/repo-conventions were already settled by a `cost: high` action.
  The plan-change protocol (judgment, not research) still applies at either tier. `low` still runs
  every numbered step (including the plan-change trigger and always reporting a silent failure or
  hidden side effect) but trims the proactive design-smell sweep — selected whenever the session
  ceiling resolves to `low` (CLI, `SOMI_COST_CEILING`, a committed `.somi/config.json`, or persisted
  state), with the ceiling and its source announced before the first agent it applies to starts, on every entry path. Overridable
  to `cost: high` in frontmatter.
- **Won't**: silently widen scope; ship without running tests; bypass hooks; let the plan show
  stale state.
- **Will**: stop and trigger the plan-change protocol if the planned approach is producing bad
  code or hits an unforeseen constraint.

### reviewer

Strict, skeptical, evidence-driven. Reviews code, plans (the `.somi/plans/<slug>/` artifact set), or
architectural proposals. Checks plan-vs-code alignment: did the diff stay within scope, did
changes get captured in `decisions.md` and `diary.md`, is `progress.md` accurate.
Severity-graded findings, will reject weak solutions.

- **Cost**: `medium, high` — graded over one job, not alternative modes: a `medium` pass and a
  `high` pass both produce a real review at different depths, and neither is insufficient for any
  diff this agent accepts.
- **Won't**: rubber-stamp; bury Blockers under Nits; review the author instead of the code; read the
  full accumulated artifact history when a bounded slice suffices (live decisions, active phase,
  recent diary entries).
- **Will**: call in support agents when the change matches their territory (via separate Task
  calls); return a proposed `review-feedback` diary entry when a finding surfaces a plan issue. Can
  run as a **parallel panel** via [`/review-panel`](./COMMANDS.md) — the relevant lenses review the
  same diff concurrently and their findings are merged into one verdict.

## The support agents

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

- **Cost**: `medium, high` — grades one job over two depths; neither is insufficient for any
  proposal this agent accepts.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`api-design`](../skills/api-design/SKILL.md) skills — skill wins on divergence.

### plan-reviewer

An independent context window on a plan: premise, user-verified decisions with real options and a
reversal cost, iteration sizing, concrete risks, and acceptance criteria that can actually fail.
Read-only; returns severity-graded findings.

- **Cost**: `medium, high` — one job over two depths; judges stay off `low`.
- **Canonical knowledge**: the [`plan-review`](../skills/plan-review/SKILL.md) skill — skill wins on
  divergence.

### sdlc-reviewer

An independent audit of a work item's paper trail against the repository: `progress.md` accuracy,
diary entries and compaction, decisions recorded before acted on, findings resolved by id, nothing
shipped that points into the planning folder. Read-only; returns severity-graded findings.

- **Cost**: `medium, high` — one job over two depths; judges stay off `low`.
- **Canonical knowledge**: the [`sdlc-process`](../skills/sdlc-process/SKILL.md) skill — skill wins
  on divergence.

### test-strategist

Decides what to test, at what level, and how. Distinguishes risk-driven coverage from
coverage-worship. Identifies when the test shape is a *design* problem.

Invoke directly via `/test-strategy`, or via `/review` when the diff has mock-heavy / flaky /
e2e-only-on-risky-code symptoms.

- **Cost**: `medium, high` — grades one job over two depths; neither is insufficient for any input
  this agent accepts.
- **Canonical knowledge**: the [`testing-playbook`](../skills/testing-playbook/SKILL.md) skill — skill wins
  on divergence.

### refactorer

Surgical, behavior-preserving structure changes. Tests stay green at every step. No feature work
mixed in. Returns the codebase to a state where the next planned change is easy.

- **Cost**: `low, medium` — no `high` member. Structured execution against an already-named
  smell, one safe diff at a time. A refactor too big for one diff is a different job, split out to
  `refactor-designer` below rather than declared as a third tier here — a caller-picked mode and a
  ceiling-picked tier can't safely name the same choice on one unit. `low` keeps the
  behavior-preservation contract (tests green after every individual transform, no behavior change)
  intact and trims commit granularity (batching mechanical steps only) plus the search for further
  smells beyond the one named — selected whenever the session ceiling resolves to `low` (CLI,
  `SOMI_COST_CEILING`, a committed `.somi/config.json`, or persisted state), with the ceiling and
  its source announced before the first agent it applies to starts, on every entry path.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`clean-code`](../skills/clean-code/SKILL.md) skills — skill wins on divergence.

### refactor-designer

Front-loaded scope design for a refactor too big for one safe diff — it spans many modules, needs
a migration, or changes a shared shape. Names the destination shape, maps seams and risks with
`file:line` pointers, confirms test-coverage gaps, and compiles the
[`brief.md`](../templates/BRIEF.md.tmpl) that `/plan-loop` → `/code-loop` execute against. The
`refactorer`/`refactor-designer` split (mirrors `planner`/`designer`'s naming) exists because the
two jobs — surgical execution and scope design — have different requirements and cannot share one
declared tier.

- **Cost**: `high` — no lower member. Every job this agent takes is scope design for a
  multi-module refactor, which a `medium` ceiling cannot honestly serve.
- **Won't**: edit code; ship an empty brief; pick the destination shape or migration approach
  silently.
- **Will**: reuse `.somi/atlas.md` when a fresh one exists rather than re-reading the repo; hand
  off to `architecture-reviewer` or `test-strategist` when the destination or coverage gap needs
  it.

Invoke directly via `/refactor-design`. Use instead of `/refactor` when the target needs more than
one reviewable diff to reach its destination.

## The utility agents

### impact

Read-only change-impact analysis. Given a proposed change, a file/symbol, or a diff, maps the
blast radius — callers/consumers, contracts crossed, test coverage, migration surface — atlas-first
when a fresh one exists, and recommends proceed / design-first / reconsider. Feeds `/design` and
`/plan` as their pre-read, or `/review-panel`'s lens selection for a diff.

- **Cost**: `medium` — no lower or higher member. This agent is a **judge**, not a builder: its
  deliverable is the proceed/design-first/reconsider verdict and, in diff mode, the review-lens
  selection. A reduced-depth pass would undercount the blast radius (skipped indirect/dynamic
  tracing) and can return a false "proceed, small" with nothing downstream to re-check it, or drop
  a warranted lens that then never runs — the same false-pass failure that keeps `reviewer` and the
  other judges off `low`. No `high` member either: even the full-depth pass is mechanical tracing
  over an already-written call graph, never open-ended research.
- **Won't**: fix anything, scaffold artifacts, write unless asked to keep the report.
- **Will**: give an honest small-blast-radius answer rather than inflating a report to justify
  itself; recommend *reconsider* when the radius is disproportionate to the stated value.

Invoke directly via `/impact`. Use before committing to `/design` or `/plan` when the cost of a
change is the open question.

### pr

Composes a PR title + description from a work item's `.somi/plans/<slug>/` artifacts (spec/rca,
verified decisions, progress, review verdicts, open findings, diary highlights). Returns the
composed markdown; never opens the PR itself.

- **Cost**: `low, medium` — grades one job over two depths. At `low`, mechanical aggregation of
  the existing artifacts into the template is already correct and usable; `medium` also matches
  house style and applies light judgment about what to omit — strictly better, never required.
- **Won't**: run `gh pr create`; hide red tests, open findings, or incomplete iterations.
- **Will**: fill the repo's own PR template when one exists rather than fighting it.

Invoke via `/pr`. The calling command shows the composed output to the user and gets confirmation
before publishing anything.

### incident

Runs the mitigate-then-account half of the incident lane, once `/incident`'s Stage 1 has framed
the incident (impact, timeline, slug, scaffolded `diary.md` + `progress.md`). Mitigates via flag
flip / revert / scoped patch — reversibility first — then runs mandatory debt capture: a
postmortem note, a seeded `/debug` or `/plan` follow-up, and a one-question guardrail retro. An
incident does not close without all three.

- **Cost**: `medium` — no lower or higher member. Both the mitigation call and the debt-capture
  accounting need full reasoning every time; neither is mechanical enough for `low`, neither is
  open-ended design work that would need `high`.
- **Won't**: relax a hook for speed; skip debt capture; run the initial user exchange itself (that
  stays in the command — a Tasked run can't pause mid-flight for it).
- **Will**: keep the incident timeline as diary entries written *as mitigation happens*, not
  reconstructed afterward.

Invoke via `/incident`, never directly — Stage 1 must run first.

## The front-door agent

### somi

A Copilot-only dispatcher, not a phase-specific agent. Selecting it as the session persona
removes the "which of the others do I need?" choice: per incoming message it runs an
invocation-mode gate first — an explicit non-`/somi` command is proxied directly, an explicit
`/somi` passes through to the `/somi` command verbatim, and anything else is classified against
[`skills/somi-routing/SKILL.md`](../skills/somi-routing/SKILL.md). It then **runs the matched
command's own procedure live, in the same turn** — the role a command body plays on Claude Code —
rather than handing the whole command to one Tasked agent. Every agent that procedure starts is
resolved individually, right as it starts, per
[`skills/somi-dispatch/SKILL.md`](../skills/somi-dispatch/SKILL.md) — the same procedure a direct
command follows at its own agent-Tasking point: the bundled `somi_resolve` MCP tool (falling back to
[`scripts/somi-dispatch.mjs`](../scripts/somi-dispatch.mjs) only where SoMi's own install path is
already known — see [`docs/PLUGIN.md`](./PLUGIN.md#bundled-mcp-server)) picks that agent's cost
tier against the session ceiling, and it is Tasked with the resolved model
(or, absent a host mapping, a model this agent picks itself for the tier and discloses as its own
choice) and its tier stated in the briefing — the same dispatch a direct command performs on Claude
Code, just triggered from inside this persona, and repeated for every agent a multi-agent command
seats rather than collapsed into a single Task.

- **Cost**: none of its own — this was always decorative: the host binds the model when the
  user selects this agent in Copilot's UI, so nothing here could ever act on a declared value. It
  is still, in effect, a thin dispatcher, not a reasoning engine: it decides *which* command starts,
  runs that command's own procedure itself, and resolves *at what tier* each agent that procedure
  starts runs.
- **Won't**: second-guess an explicit command; wrap a second opinion around `/somi`'s own
  recommendation; guess a model or tier when the resolver fails; suppress a dispatched persona's
  own checkpoints (a `gh pr create` confirmation, `/incident`'s framing exchange, `/plan`'s decision
  round-trip).
- **Will**: announce which flow it's entering and why before dispatching it; announce a `low`
  session ceiling and its source before any work runs; nudge Claude Code users toward the direct
  commands, where this agent adds no value (the direct commands already pick the right agent and
  Task it themselves there).

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

| Declared `cost:` | Agents | What it does |
|------|--------|--------------|
| **`high`** (no lower member) | `discovery-analyst`, `designer`, `security-reviewer`, `refactor-designer`, `atlas` | Front-loads research, design, decisions, and complexity mapping into a `brief.md` — every job these agents accept needs it (`atlas` front-loads a repo map instead of a work-item brief) |
| **`medium, high`** (graded over one job) | `reviewer`, `architecture-reviewer`, `test-strategist`, `plan-reviewer`, `sdlc-reviewer` | Provides fresh-eyes review at either depth; neither is insufficient for any input these agents accept — the opt-in bar for `low` below does not extend to these: a weaker judge produces a false pass, not merely a lighter one |
| **`medium`** (no lower or higher member) | `incident`, `impact` | `incident` executes against an already-framed incident without re-researching; every job is a live outage, so there is no lighter version of the mitigation/debt-capture call to make honestly. `impact` is a judge, reverted here from `low, medium`: its verdict and (in diff mode) its review-lens selection would produce a false pass at reduced depth, and its full-depth pass is already mechanical call-graph tracing rather than open-ended design, so `high` buys nothing either |
| **`low, medium`** (graded over one job) | `coder`, `planner`, `refactorer`, `pr` | `pr` grades one job over two depths — a fuller pass adds house-style matching, never required for correctness. The other three widened downward: `low` is a reduced-depth pass (each agent's own "Running at `low`" section names its trims), selected whenever the session ceiling resolves to `low` (CLI, `SOMI_COST_CEILING`, a committed `.somi/config.json`, or persisted state), with the ceiling and its source announced before the first agent it applies to starts on every entry path — so the quality drop is a trade the user can see, not one made for them unseen |

`somi` declares no `cost:` at all — exempt, not a fifth `medium` member: the host binds the model
when the user selects the agent, so a declaration here would control nothing.

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

**Orchestrator/agent cost and the prompt cache.** Commands carry no `cost:` of their own and
simply `Task` the tier-appropriate agent. Tasking a differently-costed subagent from an uncosted
orchestrator is the cache-correct way to mix costs — the orchestrator's own prompt cache stays
intact while the subagent runs on its own tier. (Prompt caches are model-scoped, so the
brief handoff is also a natural cache boundary.) **`/atlas` Tasks a `cost: high` agent
for its entire job** — the deep repo read is the whole task, so there is nothing left for the
command to do at a different tier; `/adopt` Tasks that same `atlas` agent as its own Stage 1.
**`/discover`, `/design`, and `/refactor-design` Task a `cost: high` agent for the judgment-heavy
core of their work** (their `brief.md` anchors the whole work item, so nothing about that core
needs a lower tier) **but each keeps real work command-side**: scaffolding the artifact set, and
owning the crossroads conversation with the user (the `DECISIONS-NEEDED` / `VERIFIED-DECISIONS`
round trip), which can't live inside a single `Task` call because a Tasked run can't pause to
converse. See [COMMANDS.md](./COMMANDS.md).

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
# agents at cost: high — front-load reasoning into brief.md
/discover    → discovery-analyst (writes .somi/rd/<slug>/ + brief.md; feeds /plan — greenfield only)
/design      → designer         (writes .somi/plans/<slug>/{design.md,brief.md}; feeds /plan — brownfield feature)
/atlas       → atlas            (writes .somi/atlas.md, which /design, cold /plan, /refactor-design,
                                 and /impact consume instead of re-reading)
/refactor-design → refactor-designer (writes .somi/plans/<slug>/{design.md,brief.md}; feeds /plan-loop → /code-loop)

# agents at cost: medium — execute against the brief
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
/plan-loop   → planner + reviewer  (bounded plan↔review loop, cost: low, medium planner + reviewer at cost: medium, high)
/ship-loop   → [optional cost: high front-load] → [gate at the brief handoff] → /plan-loop → /code-loop (continuous, under caps)

# Lifecycle & utility commands
/upgrade     → discovery-analyst (cited changelog/CVE research) + /code-loop (migration)
/release-readiness → reviewer   (ONE high-cost integration pass; the checklist itself is deterministic)
/incident    → incident         (Stage 1 frame stays in the command; mitigation + mandatory debt
                                 capture run in the agent; hooks stay on throughout)
/impact      → impact           (read-only blast-radius tracing, atlas-first)
/adopt       → atlas (Stage 1) + test-strategist (optional, gap-report depth)
# Note: `somi` also names a selectable Copilot agent persona (agents/somi.md) — not invoked
# via a command, so it has no row of its own here. See "The front-door agent" section above.
/somi        → (no agent — read-only status dashboard & router; this is the /somi command)
/pr          → pr               (composes the PR from artifacts, returns text; gh only after
                                 confirmation, run by the command)

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
