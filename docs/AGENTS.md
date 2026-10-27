# Agents

SoMi ships phase-specific subagents graded across **cost tiers**, plus the front door — the `somi`
dispatcher, the `somi-flow` runner and the `somi-general` fallback — documented separately in
["The front-door agents"](#the-front-door-agents) below. The **`cost: high`** tier front-loads the
expensive reasoning — research, design, decisions, complexity mapping, and fresh-eyes review — and
compiles it into a dense `brief.md`. The **`cost: medium`** tier executes against that brief without
re-researching. See [Cost tiering](#cost-tiering) below.

| Agent                                                        | Default tier   | When                                                                  |
|--------------------------------------------------------------|----------------|-----------------------------------------------------------------------|
| [`somi-discovery-analyst`](../agents/somi-discovery-analyst.md)        | `high`         | New product / greenfield idea, before planning; requirements + research |
| [`somi-designer`](../agents/somi-designer.md)                          | `high`         | Design-heavy feature / user story on an existing codebase, before planning |
| [`somi-atlas`](../agents/somi-atlas.md)                                | `high`         | Build or refresh the repo-level map (`.somi/atlas.md`) that later design actions read first |
| [`somi-refactorer`](../agents/somi-refactorer.md)                      | `medium`       | The next change needs untangling first, contained to one safe behavior-preserving diff |
| [`somi-refactor-designer`](../agents/somi-refactor-designer.md)        | `high`         | The untangle spans many modules / needs a migration — too big for one diff; designs scope + brief |
| [`somi-reviewer`](../agents/somi-reviewer.md)                          | `high`         | Before merge; whenever you want a skeptical second opinion            |
| [`somi-security-reviewer`](../agents/somi-security-reviewer.md)        | `high`         | Auth, crypto, secrets, input validation, deserialization, file uploads |
| [`somi-architecture-reviewer`](../agents/somi-architecture-reviewer.md)| `high`         | New module/service/contract; dependency direction change              |
| [`somi-plan-reviewer`](../agents/somi-plan-reviewer.md)                | `high`         | An independent read of a plan, brief, or ADR before it is approved or executed |
| [`somi-sdlc-reviewer`](../agents/somi-sdlc-reviewer.md)                | `high`         | Audit that progress, diary, decisions, and findings match the repository |
| [`somi-test-strategist`](../agents/somi-test-strategist.md)            | `high`         | Test shape feels wrong; deciding unit vs. integration; flake debugging |
| [`somi-planner`](../agents/somi-planner.md)                            | `medium`       | Non-trivial change; sequence the design (brief) into phases           |
| [`somi-coder`](../agents/somi-coder.md)                                | `medium`       | Executing against an approved plan + brief; small, well-scoped tasks  |
| [`somi-impact`](../agents/somi-impact.md)                              | `medium`       | Blast-radius mapping before committing to `/design` or `/plan`; lens selection for a diff |
| [`somi-pr`](../agents/somi-pr.md)                                       | `medium`       | Compose a PR title + description from a work item's artifacts         |
| [`somi-incident`](../agents/somi-incident.md)                          | `medium`       | Mitigate + mandatory debt capture once an incident is framed          |
| [`somi-flow`](../agents/somi-flow.md)                          | `medium`       | Started by the `somi` dispatcher: runs one named workflow from its `flow-<name>` skill, starting the specialists |
| [`somi-general`](../agents/somi-general.md)                    | `medium`       | Started by the `somi` dispatcher for a request that matches no workflow; hands back a `REROUTE` if it turns out to be one |
| [`somi`](../agents/somi.md)                                   | none           | The front door (made for GitHub Copilot): a dispatcher that routes each message to `somi-flow` or `somi-general` and never does the work (see "The front-door agents" below) |

## How agents get invoked

Every workflow's procedure is one skill, `skills/flow-<name>/SKILL.md`, with two entry points:
the command (`commands/<name>.md`, a thin wrapper that runs the procedure in the main conversation
on Claude Code) and the `somi-flow` runner (which runs the same procedure as a subagent when the
`somi` dispatcher starts it). Either way the procedure starts the specialists below. Three paths:

1. **User invokes a command** (`/plan`, `/code`, `/review`), or asks the `somi` dispatcher, which
   hands the workflow to `somi-flow` → the procedure calls the corresponding core agent.
2. **A core agent escalates** during its work — e.g., coder hits auth code and asks whether to
   consult `somi-security-reviewer`.
3. **User invokes a specialised command** (`/security-review`, `/architecture-review`,
   `/test-strategy`, `/refactor`) which directly targets a support agent. (Plan-level review
   uses `/review plan <slug>` — there is no separate `/plan-review`.)

**What agents share: the run card.** Agents never share a conversation: each starts from a fresh
context, so a reviewer cannot inherit the coder's reasoning. What a code-review loop does share is a run
card, printed once by `scripts/somi-card.mjs` from the loop state and pasted unchanged as the first block
of every briefing in that loop: where SoMi's scripts are, the project, the plan files to read, the files in
scope, the baseline, the test command, and which files only the orchestrator writes. Facts, under 2 KB,
byte-identical across passes, so agents stop re-deriving them and a repeated start can reuse the prompt
cache. The orchestrator itself does not read or edit the code under change or run its tests; it runs the
loop's scripts and persists what the agents return.

SoMi prefers **explicit handoff** over silent specialisation. When a core agent thinks a
support agent should be consulted, it surfaces the recommendation; the human (or the
orchestrating command) decides.

Whichever path starts the agent — a flow procedure run from its command, the same procedure run by
`somi-flow`, or the dispatcher starting `somi-flow` / `somi-general` — the same
[`skills/somi-dispatch`](../skills/somi-dispatch/SKILL.md) procedure is what resolves its cost tier
and model against the session ceiling. This is a prompt-level instruction, not code that runs the
resolution deterministically; what `scripts/validate.sh` mechanically checks is narrower — that
every flow skill whose text starts a real agent references the skill somewhere in its own text,
failing the build otherwise.

## The discovery agent

### somi-discovery-analyst

Pre-development requirements engineering + competitive research + high-level software design, rolled
into one. Turns a raw idea into the `.somi/rd/<slug>/` document set (research report, BRD, SRS, FRD,
SDD, TDD) with full traceability — every requirement traces to a business goal and a research
finding. Pauses for **user verification** on every requirement- or direction-shaping decision, with
the same options/pros-cons/recommend/`Other`/`Discover` protocol as the planner. Researches the
competition and mines real user complaints to design *away* from known failure modes; cites every
non-obvious claim and never fabricates. Respects the **design-depth boundary**: sets architectural
*direction* (high-level SDD/TDD) and hands *detailed* design to the planner.

- **Cost**: default tier `high` — no lower member. `/discover` declares no `cost:` of its own (a command has no
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

### somi-designer

Feature / user-story design at **`cost: high`**, against an **existing codebase**. Fills the gap
between `somi-discovery-analyst` (a whole new product) and `somi-planner` (sequencing): when a requirement is
clear but the architecture against this repo is not, the designer reads the codebase deeply, resolves
the expensive-to-reverse decisions with the user (same verification protocol as the planner), maps
the complexity hotspots, and compiles a dense [`brief.md`](../templates/BRIEF.md.tmpl) plus a
`design.md`. That brief is the load-bearing output — it lets the medium-cost planner/coder execute
**without re-deriving the architecture**.

- **Cost**: default tier `high` — no lower member. `/design` declares no `cost:` of its own (like `/discover`)
  and Tasks this agent for the judgment-heavy core of the work — the brief anchors everything
  downstream. The command itself still scaffolds the artifact set and owns the crossroads
  conversation with the user, for the same reason as `/discover`'s.
- **Won't**: plan or code; produce file-by-file design (that's the planner); pick architecture
  silently; emit a bloated brief or an empty "what execution need not re-research" section.
- **Will**: ingest the repo's own instruction files once and distil them into the brief; hand off to
  `/plan` with an explicit handoff line; hand back to the planner if the design is trivial.

Invoke directly via `/design`. Use *before* `/plan` when the architecture isn't settled.

### somi-atlas

One deep read of the whole repository, distilled into **`.somi/atlas.md`** (module map, dependency
rules, conventions digest, hotspots, test topology) — the repo-level counterpart to `brief.md`:
`brief.md` compresses a work item, the atlas compresses the repository. Paid once, amortized by
every later design-time read: `/design`, a cold `/plan`, `/refactor-design`, and `/impact` all read
it first and deep-read only the drift since its stamped SHA.

- **Default tier**: `high` — no lower member. The whole value is one high-quality read of the repository;
  a shallower pass produces a map later consumers trust without earning that trust.
- **Won't**: edit anything outside `.somi/atlas.md` (and `.somi/README.md` if missing); describe
  the intended architecture instead of the one actually in the code.
- **Will**: run its own staleness check (`git diff --stat` against its stamped SHA) and refresh
  only the drifted sections rather than rebuild from scratch on small drift.

Invoke directly via `/atlas`, or as `/adopt`'s Stage 1.

## The build agents

### somi-planner

Staff-engineer-grade planning. Produces the `.somi/plans/<slug>/` artifact set (context, spec,
decisions, progress, diary, phases). Pauses for **user verification** on every architectural or
design decision: presents 2–4 concrete options with explicit pros and cons (no vague phrasings),
recommends one, and offers `Other` (user-proposed option) plus `Discover` (guided narrowing
questions) as escape hatches.

- **Default tier**: `medium` (`low` opt-in) — planning is *sequencing an already-compiled design*, not
  open-ended research. When a design action ran upstream, the planner consumes its `brief.md` and
  slices it into phases. For a cold, design-heavy plan with no brief, the planner runs a **depth
  gate** and recommends `/design` (Tasks `somi-designer` at its default tier `high`) first. `low` still produces
  the full artifact set (and still keeps the false-premise/contradiction checks, the depth gate,
  and `Pros`/`Cons`/`Reverses` on the recommended option) but trims the alternatives comparison and
  Discovery mode's guided flow — selected for a `low` ceiling (flag, env var, `cost.ceiling`, or one
  set earlier by flag or env var) or a `cost.agents` entry of `low`, with the ceiling and
  its source announced before the first agent it applies to starts, on every entry path (see
  [`skills/somi-dispatch`](../skills/somi-dispatch/SKILL.md)). Set `cost.agents.<agent>` in
  `.somi/config.json` to run it at another tier.
- **Won't**: write code, silently pick architectural defaults, take the request's framing as truth.
- **Will**: stop and recommend re-scoping if the work is much larger than presented; **challenge the
  request's premise** (false premise, XY problem, contradiction, already-solved need) before planning
  and pause if it doesn't hold.

### somi-coder

Elite implementation. Executes against the plan with senior-level design judgment. Updates
`progress.md`, the phase file, and `diary.md` as it works. Follows the **plan-change protocol**
when implementation reveals the plan needs changing: updates spec/decisions/phases in place,
appends a diary entry, surfaces to the user before continuing.

- **Default tier**: `medium` (`low` opt-in) — coding executes against the plan + `brief.md`, where the
  architecture/decisions/complexity/repo-conventions were already settled by a `cost: high` action.
  The plan-change protocol (judgment, not research) still applies at either tier. `low` still runs
  every numbered step (including the plan-change trigger and always reporting a silent failure or
  hidden side effect) but trims the proactive design-smell sweep — selected for a `low` ceiling
  (flag, env var, `cost.ceiling`, or one set earlier by flag or env var) or a `cost.agents` entry of
  `low`, with the ceiling and its source announced before the first agent it applies to starts, on
  every
  entry path. Set `cost.agents.<agent>` in `.somi/config.json` to run it at another tier.
- **Won't**: silently widen scope; ship without running tests; bypass hooks; let the plan show
  stale state.
- **Will**: stop and trigger the plan-change protocol if the planned approach is producing bad
  code or hits an unforeseen constraint; before editing, map every place the change must reach
  (callers, fixtures, config, exports) and what it could break; mark a shortcut it keeps on purpose
  with a `shortcut: <the limit>, <when to upgrade>` comment.

### somi-reviewer

Strict, skeptical, evidence-driven. Reviews code, plans (the `.somi/plans/<slug>/` artifact set), or
architectural proposals. Checks plan-vs-code alignment: did the diff stay within scope, did
changes get captured in `decisions.md` and `diary.md`, is `progress.md` accurate.
Severity-graded findings, will reject weak solutions.

- **Default tier**: `high` (`medium` also acceptable) — graded over one job, not alternative modes: a `medium` pass and a
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

### somi-security-reviewer

OWASP-Top-10-lens audit. Trust-boundary-to-sink walks. Findings include **attack paths** in plain
language (preconditions, what gets executed, what the attacker gains), not just CVE-name dropping.

Invoke directly via `/security-review`, or via `/review` on a diff that touches sensitive
territory (the reviewer auto-invokes when the consultant-trigger table fires).

- **Cost**: `high`.
- **Canonical knowledge**: the [`owasp-defense`](../skills/owasp-defense/SKILL.md) and
  [`threat-modeling`](../skills/threat-modeling/SKILL.md) skills — on a technique divergence, the
  skill wins. The agent owns the actor role (when/how to trace, what to produce).

### somi-architecture-reviewer

Structural decisions — new module/service, dependency direction, public-contract introduction,
ADR review. Time horizon is years; reversibility is a first-class concern.

Invoke directly via `/architecture-review`, or via `/review` when the change introduces a
contract/module/service (the consultant-trigger table auto-invokes).

- **Default tier**: `high` (`medium` also acceptable) — grades one job over two depths; neither is insufficient for any
  proposal this agent accepts.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`api-design`](../skills/api-design/SKILL.md) skills — skill wins on divergence.

### somi-plan-reviewer

An independent context window on a plan: premise, user-verified decisions with real options and a
reversal cost, iteration sizing, concrete risks, and acceptance criteria that can actually fail.
Read-only; returns severity-graded findings.

- **Default tier**: `high` (`medium` also acceptable) — one job over two depths; judges stay off `low`.
- **Canonical knowledge**: the [`plan-review`](../skills/plan-review/SKILL.md) skill — skill wins on
  divergence.

### somi-sdlc-reviewer

An independent audit of a work item's paper trail against the repository: `progress.md` accuracy,
diary entries and compaction, decisions recorded before acted on, findings resolved by id, nothing
shipped that points into the planning folder. Read-only; returns severity-graded findings.

- **Default tier**: `high` (`medium` also acceptable) — one job over two depths; judges stay off `low`.
- **Canonical knowledge**: the [`sdlc-process`](../skills/sdlc-process/SKILL.md) skill — skill wins
  on divergence.

### somi-test-strategist

Decides what to test, at what level, and how. Distinguishes risk-driven coverage from
coverage-worship. Identifies when the test shape is a *design* problem.

Invoke directly via `/test-strategy`, or via `/review` when the diff has mock-heavy / flaky /
e2e-only-on-risky-code symptoms.

- **Default tier**: `high` (`medium` also acceptable) — grades one job over two depths; neither is insufficient for any input
  this agent accepts.
- **Canonical knowledge**: the [`testing-playbook`](../skills/testing-playbook/SKILL.md) skill — skill wins
  on divergence.

### somi-refactorer

Surgical, behavior-preserving structure changes. Tests stay green at every step. No feature work
mixed in. Returns the codebase to a state where the next planned change is easy.

- **Default tier**: `medium` (`low` opt-in) — no `high` member. Structured execution against an already-named
  smell, one safe diff at a time. A refactor too big for one diff is a different job, split out to
  `somi-refactor-designer` below rather than declared as a third tier here — a caller-picked mode and a
  ceiling-picked tier can't safely name the same choice on one unit. `low` keeps the
  behavior-preservation contract (tests green after every individual transform, no behavior change)
  intact and trims commit granularity (batching mechanical steps only) plus the search for further
  smells beyond the one named — selected for a `low` ceiling (flag, env var, `cost.ceiling`, or one
  set earlier by flag or env var) or a `cost.agents` entry of `low`, with the ceiling and
  its source announced before the first agent it applies to starts, on every entry path.
- **Canonical knowledge**: the [`solid-principles`](../skills/solid-principles/SKILL.md) and
  [`clean-code`](../skills/clean-code/SKILL.md) skills — skill wins on divergence.

### somi-refactor-designer

Front-loaded scope design for a refactor too big for one safe diff — it spans many modules, needs
a migration, or changes a shared shape. Names the destination shape, maps seams and risks with
`file:line` pointers, confirms test-coverage gaps, and compiles the
[`brief.md`](../templates/BRIEF.md.tmpl) that `/plan-loop` → `/code-loop` execute against. The
`somi-refactorer`/`somi-refactor-designer` split (mirrors `somi-planner`/`somi-designer`'s naming) exists because the
two jobs — surgical execution and scope design — have different requirements and cannot share one
default tier.

- **Cost**: default tier `high` — no lower member. Every job this agent takes is scope design for a
  multi-module refactor, which is why its default tier is `high` with no lower member; under a lower ceiling it runs
  degraded unless `cost.agents` pins it.
- **Won't**: edit code; ship an empty brief; pick the destination shape or migration approach
  silently.
- **Will**: reuse `.somi/atlas.md` when a fresh one exists rather than re-reading the repo; hand
  off to `somi-architecture-reviewer` or `somi-test-strategist` when the destination or coverage gap needs
  it.

Invoke directly via `/refactor-design`. Use instead of `/refactor` when the target needs more than
one reviewable diff to reach its destination.

## The utility agents

### somi-impact

Read-only change-impact analysis. Given a proposed change, a file/symbol, or a diff, maps the
blast radius — callers/consumers, contracts crossed, test coverage, migration surface — atlas-first
when a fresh one exists, and recommends proceed / design-first / reconsider. Feeds `/design` and
`/plan` as their pre-read, or `/review-panel`'s lens selection for a diff.

- **Cost**: `medium` — no lower or higher member. This agent is a **judge**, not a builder: its
  deliverable is the proceed/design-first/reconsider verdict and, in diff mode, the review-lens
  selection. A reduced-depth pass would undercount the blast radius (skipped indirect/dynamic
  tracing) and can return a false "proceed, small" with nothing downstream to re-check it, or drop
  a warranted lens that then never runs — the same false-pass failure that keeps `somi-reviewer` and the
  other judges off `low`. No `high` member either: even the full-depth pass is mechanical tracing
  over an already-written call graph, never open-ended research.
- **Won't**: fix anything, scaffold artifacts, write unless asked to keep the report.
- **Will**: give an honest small-blast-radius answer rather than inflating a report to justify
  itself; recommend *reconsider* when the radius is disproportionate to the stated value.

Invoke directly via `/impact`. Use before committing to `/design` or `/plan` when the cost of a
change is the open question.

### somi-pr

Composes a PR title + description from a work item's `.somi/plans/<slug>/` artifacts (spec/rca,
verified decisions, progress, review verdicts, open findings, diary highlights). Returns the
composed markdown; never opens the PR itself.

- **Default tier**: `medium` (`low` opt-in) — grades one job over two depths. At `low`, mechanical aggregation of
  the existing artifacts into the template is already correct and usable; `medium` also matches
  house style and applies light judgment about what to omit — strictly better, never required.
- **Won't**: run `gh pr create`; hide red tests, open findings, or incomplete iterations.
- **Will**: fill the repo's own PR template when one exists rather than fighting it.

Invoke via `/pr`. The calling command shows the composed output to the user and gets confirmation
before publishing anything.

### somi-incident

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

## The front-door agents

Three agents carry a request from the user to the specialists. None of them does specialist work.

```
user ─▶ somi (dispatcher, the session agent) ── one start per request ──▶ somi-flow   ─▶ specialists
                ▲                                                    └─▶ somi-general
                └── CHECKPOINT → asks the user → RESUME ◀──────────────────┘
```

Depth stays at two below the session: a composite workflow (`/ship-loop` running `/plan-loop` and
`/code-loop`) loads its sub-flows' skills and runs them inside the same `somi-flow`, never a second
runner. That keeps every specialist reachable on both hosts: Claude Code nests subagents three deep
by default, and Copilot CLI nests one level below a subagent. A subagent cannot ask the user on
either host, so every user gate inside a workflow crosses back as a `CHECKPOINT` block
([`skills/somi-checkpoint`](../skills/somi-checkpoint/SKILL.md)): the runner saves its state to
`.somi/`, returns the questions and stops; the dispatcher asks the user and starts the runner again
with a `RESUME` block carrying the answers.

### somi

The dispatcher, and the agent a GitHub Copilot user selects for the session (Copilot runs one agent
per session; on Claude Code the direct commands already reach each workflow). Per message it strips
its own `/somi`/`@somi` marker, relays a pending checkpoint's answer, and otherwise picks one target:
nothing left → the `status` dashboard flow; a known command → that flow; free text → the
[`somi-routing`](../skills/somi-routing/SKILL.md) table, with `somi-general` as the row for
everything else. It announces the choice in one line, resolves and starts the agent through
[`skills/somi-dispatch`](../skills/somi-dispatch/SKILL.md), and relays the result.

- **Cost**: none of its own — the host binds the model when the user selects the agent.
- **Won't**: do the work itself (edit, run commands, read the project to answer, follow a
  procedure, play a specialist); re-classify an explicit command; start any agent other than
  `somi-flow` or `somi-general`.
- **Will**: keep its context free of procedure text: everything a workflow does lives in the flow
  skill the runner loads. This is the fix for a front door that used to run every procedure in its
  own context (about 115 KB over one `/ship-loop` run, against about 25 KB now) and, once that context was
  full or compacted, did the work itself about half the time. It has no `tools:` restriction (no
  SoMi agent declares one), so staying a dispatcher is an instruction, kept short so it stays in view.

**There is no `/somi` command.** Copilot prefixes every message to this agent with `/somi`/`@somi`,
so a same-named command was indistinguishable from that marker and swallowed every request (fixed in
2.2.1 by removing the command). See the maintainer notes in [`agents/somi.md`](../agents/somi.md).

### somi-flow

The workflow runner. Its briefing names one flow (`plan`, `code-loop`, `ship-loop`, `status`, …) and
the request; it loads [`flow-<name>`](./SKILLS.md#workflow-procedures) and follows it step by step,
starting every specialist through `somi-dispatch`, and ends with a `DONE`, `STOPPED` or
`CHECKPOINT` block.

- **Default tier**: `medium` — it orchestrates; the judgment-heavy work runs in the specialists it
  starts, at their own tiers.
- **Won't**: ask the user directly; skip a step, gate or cap; play a specialist's role; start
  another `somi-flow`.
- **Will**: resume from a `RESUME` block by reloading the flow skill and checking disk state
  against the checkpoint's context, never from memory.

### somi-general

The fallback for requests that match no workflow: questions about the code or the project,
explanations, research, git or shell housekeeping, help with SoMi itself.

- **Default tier**: `medium`.
- **Won't**: edit tracked project files or start agents. A request that turns out to be a code
  change, a bug, a review, a design or another workflow comes back as `REROUTE <flow>`, so it gets
  that workflow's review, caps and paper trail.
- **Will**: return a `CHECKPOINT` before anything outward-facing or hard to reverse.

## Cost tiering

SoMi tiers models by **SDLC phase**, not by orchestration depth. The expensive model is spent once,
up front, to compile a dense handoff; the cheap model does the high-volume execution against it.
See [`scripts/lib/cost-model.mjs`](../scripts/lib/cost-model.mjs) for the current `cost` → model
mapping per host — this doc names the tier, not the model, so a repricing or a new model stays a
one-file change.

| Default tier | Agents | What it does |
|------|--------|--------------|
| **`high`** (no lower member) | `somi-discovery-analyst`, `somi-designer`, `somi-security-reviewer`, `somi-refactor-designer`, `somi-atlas` | Front-loads research, design, decisions, and complexity mapping into a `brief.md` — every job these agents accept needs it (`somi-atlas` front-loads a repo map instead of a work-item brief) |
| **`high`** (also runs at `medium`; graded over one job) | `somi-reviewer`, `somi-architecture-reviewer`, `somi-test-strategist`, `somi-plan-reviewer`, `somi-sdlc-reviewer` | Provides fresh-eyes review at either depth; neither is insufficient for any input these agents accept — the opt-in bar for `low` below does not extend to these: a weaker judge produces a false pass, not merely a lighter one |
| **`medium`** (no lower or higher member) | `somi-incident`, `somi-impact` | `somi-incident` executes against an already-framed incident without re-researching; every job is a live outage, so there is no lighter version of the mitigation/debt-capture call to make honestly. `somi-impact` is a judge, reverted here from a `low` member: its verdict and (in diff mode) its review-lens selection would produce a false pass at reduced depth, and its full-depth pass is already mechanical call-graph tracing rather than open-ended design, so `high` buys nothing either |
| **`medium`** (also runs at `low`; graded over one job) | `somi-coder`, `somi-planner`, `somi-refactorer`, `somi-pr` | `somi-pr` grades one job over two depths — a fuller pass adds house-style matching, never required for correctness. The other three widened downward: `low` is a reduced-depth pass (each agent's own "Running at `low`" section names its trims), selected for a `low` ceiling (flag, env var, `cost.ceiling`, or one set earlier by flag or env var) or a `cost.agents` entry of `low`, with the ceiling and its source announced before the first agent it applies to starts on every entry path — so the quality drop is a trade the user can see, not one made for them unseen |

`somi` has no table entry — exempt, not a fifth `medium` member: the host binds the model
when the user selects the agent, so a default tier here would control nothing. The table is
[`scripts/lib/cost-defaults.mjs`](../scripts/lib/cost-defaults.mjs); a project overrides any entry
with `cost.agents` in `.somi/config.json`.

The handoff is the [`brief.md`](../templates/BRIEF.md.tmpl) (`templates/BRIEF.md.tmpl`): a dense,
bounded, reference-not-inline distillation with an explicit **"What execution does NOT need to
re-research"** section. The `high` pass writes it; `medium` execution consumes it. This
is the **plan-and-execute / model-cascade** pattern (strong planner, cheap executor).

**Why this saves spend without losing quality.** Previously every agent ran at the top cost tier,
spreading the expensive model across the whole lifecycle — including the highest-volume work
(iterative coding, plan detail). Now the expensive model concentrates where it pays off: (a) the
front-loaded brief, and (b) fresh-eyes review. The bulk token volume — sequencing and iterating —
runs at its default tier `medium`, fed by the brief. The agent's resolved model is overridable per project in
`cost.agents` and the per-host mapping.

**Orchestrator/agent cost and the prompt cache.** Commands carry no `cost:` of their own and
simply `Task` the tier-appropriate agent. Tasking a subagent with a different default tier from a tierless
orchestrator is the cache-correct way to mix costs — the orchestrator's own prompt cache stays
intact while the subagent runs on its own tier. (Prompt caches are model-scoped, so the
brief handoff is also a natural cache boundary.) **`/atlas` Tasks a `high`-default agent
for its entire job** — the deep repo read is the whole task, so there is nothing left for the
command to do at a different tier; `/adopt` Tasks that same `somi-atlas` agent as its own Stage 1.
**`/discover`, `/design`, and `/refactor-design` Task a `high`-default agent for the judgment-heavy
core of their work** (their `brief.md` anchors the whole work item, so nothing about that core
needs a lower tier) **but each keeps real work command-side**: scaffolding the artifact set, and
owning the crossroads conversation with the user (the `DECISIONS-NEEDED` / `VERIFIED-DECISIONS`
round trip), which can't live inside a single `Task` call because a Tasked run can't pause to
converse. See [COMMANDS.md](./COMMANDS.md).

## Adding new agents

See [EXTENDING.md](./EXTENDING.md). The short version:

1. Add `agents/<name>.md` with proper frontmatter (`name`, `description`; no `cost:` or `model:`, which `scripts/validate.sh` rejects — add the agent's default tier to `scripts/lib/cost-defaults.mjs`). Omit `tools:` —
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

A specialist does not Task other specialists: escalations are surfaced as **recommendations** to
the calling procedure, which decides whether to Task the next agent. (The hosts allow nesting, and
`somi-flow` uses one level of it; specialists stay leaves so the depth stays at two.) `/review` is the structural
entrypoint that auto-invokes consultants (security-reviewer, architecture-reviewer,
test-strategist) based on the trigger table in [`flow-review`](../skills/flow-review/SKILL.md) — so
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
             + plan-reviewer + sdlc-reviewer
             (seated by relevance, run concurrently, findings merged into one verdict)
/security-review     → security-reviewer
/architecture-review → architecture-reviewer (+ security-reviewer if security implications)
/test-strategy       → test-strategist
/refactor    → refactorer

/ship        → [optional high-tier front-load] → /plan + (per iteration) /code-loop  (human gate at every stage)
/plan-loop   → planner + reviewer  (bounded plan↔review loop, planner default medium + reviewer default high)
/ship-loop   → [optional high-tier front-load] → [gate at the brief handoff] → /plan-loop → /code-loop (continuous, under caps)

# Lifecycle & utility commands
/upgrade     → discovery-analyst (cited changelog/CVE research) + /code-loop (migration)
/release-readiness → reviewer   (ONE high-cost integration pass; the checklist itself is deterministic)
/incident    → incident         (Stage 1 frame stays in the command; mitigation + mandatory debt
                                 capture run in the agent; hooks stay on throughout)
/impact      → impact           (read-only blast-radius tracing, atlas-first)
/adopt       → atlas (Stage 1) + test-strategist (optional, gap-report depth)
# Note: `somi` names a selectable Copilot agent persona (agents/somi.md) only — there is no
# `/somi` command, so it has no row of its own here. See "The front-door agents" section above.
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
generated it. The same mechanics apply to `somi-designer` and `somi-discovery-analyst`.

See [`role-planner`](../skills/role-planner/SKILL.md) for the full protocol, the block shapes, and examples.
