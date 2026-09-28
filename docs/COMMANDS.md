# Slash command reference

Every SoMi command is a Claude Code slash command defined under `commands/`. Commands are the
**user-facing entrypoints** to workflows; they orchestrate one or more agents and produce durable
artifacts inside `.somi/plans/<slug>/` and `.somi/reviews/<slug>/`.

## Command catalogue

| Command                                                  | Workflow            | Agent(s) invoked                                                                          | Output                                                                       |
|----------------------------------------------------------|---------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| [`/discover`](../commands/discover.md)                   | Discovery (pre-dev) | `discovery-analyst` (`cost: high`)                                                                  | `.somi/rd/<slug>/` (research report, BRD, SRS, FRD, SDD, TDD, decisions, diary, README, **brief**) |
| [`/design`](../commands/design.md)                       | Feature design | `designer` (`cost: high`)                                                                               | `.somi/plans/<slug>/` (design, decisions, **brief**, diary) — the design→execution handoff for a brownfield feature |
| [`/atlas`](../commands/atlas.md)                         | Repo cartography | `atlas` (`cost: high`)                                                                                    | `.somi/atlas.md` — SHA-stamped repo map (modules, dependency rules, conventions, hotspots, test topology) that later design actions consume instead of re-reading the repo |
| [`/plan`](../commands/plan.md)                           | Planning      | `planner` (`cost: low, medium`)                                                                            | `.somi/plans/<slug>/` (context, spec, decisions, progress, diary, phases/)   |
| [`/plan-loop`](../commands/plan-loop.md)                 | Bounded planning    | `planner` (`cost: low, medium`) + `reviewer` (`cost: medium, high`)                       | `.somi/plans/<slug>/` + plan reviews under `.somi/reviews/<slug>/`           |
| [`/code`](../commands/code.md)                           | Coding              | `coder` (`cost: low, medium`)                                                             | diff + tests; updates `progress.md` + `diary.md`                             |
| [`/debug`](../commands/debug.md)                         | Debugging           | `coder` (`cost: low, medium`) (+ `reviewer` (`cost: medium, high`) as high-cost diagnosis hatch, `test-strategist` (`cost: medium, high`) on test-shape gaps) | `.somi/plans/<slug>/rca.md` (root-cause record) + repro test + fix diff (via `/code-loop`) |
| [`/code-loop`](../commands/code-loop.md)                 | Bounded coding      | `coder` (`cost: low, medium`) + `reviewer` (`cost: medium, high`) (or `/review-panel`'s four lenses when `SOMI_CODE_LOOP_REVIEW=panel`) | diff + tests + per-pass review files; bounded by caps                        |
| [`/code-parallel`](../commands/code-parallel.md)         | Parallel coding     | none of its own — router; per eligible iteration: `/code-loop` (see its row) in an isolated git worktree | diffs built in parallel, **integrated sequentially** behind a per-merge test + review gate |
| [`/review`](../commands/review.md)                       | Reviewing           | `reviewer` (`cost: medium, high`) (+ `security-reviewer` (`cost: high`) / `architecture-reviewer` (`cost: medium, high`) / `test-strategist` (`cost: medium, high`) per triggers) | `.somi/reviews/<slug>/<YYYY-MM-DD>-…md` (code or plan review)                |
| [`/review-panel`](../commands/review-panel.md)           | Parallel review     | `reviewer` (`cost: medium, high`) + `security-reviewer` (`cost: high`) / `architecture-reviewer` (`cost: medium, high`) / `test-strategist` (`cost: medium, high`), run **concurrently** | `.somi/reviews/<slug>/<YYYY-MM-DD>-…-panel-<verdict>.md` (one merged, de-duplicated verdict) |
| [`/security-review`](../commands/security-review.md)     | Security QA         | `security-reviewer` (`cost: high`)                                                        | `.somi/reviews/<slug>/<YYYY-MM-DD>-security-…md`                             |
| [`/architecture-review`](../commands/architecture-review.md) | Architecture QA | `architecture-reviewer` (`cost: medium, high`) (+ `security-reviewer` (`cost: high`) when relevant) | `.somi/reviews/<slug>/<YYYY-MM-DD>-arch-…md`                                 |
| [`/test-strategy`](../commands/test-strategy.md)         | Test-strategy QA    | `test-strategist` (`cost: medium, high`)                                                  | `.somi/reviews/<slug>/<YYYY-MM-DD>-test-strategy-…md`                        |
| [`/refactor`](../commands/refactor.md)                   | Refactoring | `refactorer` (`cost: low, medium`)                                                               | diff (behavior-preserving)                                                   |
| [`/refactor-design`](../commands/refactor-design.md)     | Large-refactor scope design | `refactor-designer` (`cost: high`)                                                | `.somi/plans/<slug>/` (design, decisions, **brief**, diary) — feeds `/plan-loop` → `/code-loop` |
| [`/impact`](../commands/impact.md)                       | Impact analysis     | `impact` (`cost: medium`; read-only tracing, atlas-first)                                  | blast-radius report: callers, contracts, test gaps, warranted review lenses, proceed/design-first/reconsider recommendation |
| [`/adopt`](../commands/adopt.md)                         | Onboarding          | `atlas` (`cost: high`) (+ `test-strategist` (`cost: medium, high`) for depth)              | atlas + confirmed `99-overrides.md` + adoption gap report + calibration recommendation |
| [`/upgrade`](../commands/upgrade.md)                     | Dependency upgrade  | `discovery-analyst` (`cost: high`) (research) + `/code-loop` (see its row) (migration)     | cited breaking-change mini-brief + migrated call sites + green suite         |
| [`/release-readiness`](../commands/release-readiness.md) | Release gate        | `reviewer` (`cost: medium, high`; one integration pass; checklist is deterministic)        | release verdict (`ready` / `-with-conditions` / `not-ready`) + evidence table + draft release notes |
| [`/incident`](../commands/incident.md)                   | Incident lane       | `incident` (`cost: medium`; frame stays in the command; seeds `/debug` or `/plan` after)   | mitigation + diary timeline + mandatory postmortem note + seeded follow-up work item |
| [`/ship`](../commands/ship.md)                           | Full pipeline       | `planner` (`cost: low, medium`) + (per iteration) `/code-loop` (see its row)               | full `.somi/plans/<slug>/` set + iteration diffs + reviews                   |
| [`/ship-loop`](../commands/ship-loop.md)                 | Bounded pipeline    | none of its own — router; `/plan-loop` (see its row) → `/code-loop` (see its row) per iteration | as `/ship`, with both layers under caps and a hard human gate between them   |
| [`/somi`](../commands/somi.md)                           | Status & routing    | none — read-only over the artifacts                                                       | status table with per-item next actions; or a routed recommendation for a new request |
| [`/pr`](../commands/pr.md)                               | PR handoff          | `pr` (`cost: low, medium`; composes from artifacts, returns text; `gh` after confirmation, run by the command) | PR title + description distilled from the work item; optionally the opened PR |

> **Note:** `/plan-review` no longer exists as a separate command — plan-level review is part of
> `/review` (use `/review plan <slug>` or pass an `.somi/plans/<slug>/` path).

> `/somi`'s Mode 2 classification table lives in
> [`skills/somi-routing/SKILL.md`](../skills/somi-routing/SKILL.md) — shared with the `somi`
> agent, GitHub Copilot's front-door persona (see [`docs/PLUGIN.md`](./PLUGIN.md)).

## Command file shape

Each command lives in `commands/<name>.md` with frontmatter:

```markdown
---
description: Short one-liner shown in / autocomplete.
argument-hint: <how to phrase arguments>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
---

# /command-name — Title

The body of the command (the prompt that runs when the user types `/command-name`).
You can reference `$ARGUMENTS` to insert the user's argument string.
```

The command body is essentially a **prompt template**. It tells Claude what to do when the user
invokes the command. SoMi commands typically:

1. Validate input (ask the user if `$ARGUMENTS` is missing/unclear).
2. Resolve context — work-item slug, current iteration, target diff.
3. Invoke one or more agents via the Task tool.
4. Write artifacts under `.somi/plans/<slug>/` (the **command** owns the writes — review agents are
   contractually forbidden from writing and return text; the command persists).
5. Update `progress.md` and `diary.md` as appropriate.
6. Summarise back with verdict + next step.

## Why commands are thin orchestrators

The heavy lifting lives in **agents**. Commands are deliberately small because:

- They're easy to read and modify.
- They make the workflow visible — a new team member can read `/plan.md` in 60 seconds and
  understand what the planner workflow does.
- They isolate orchestration from agent-internal behavior; you can swap an agent's prompt without
  touching the command.
- They carry no `cost:` of their own, and no `model:` either — `cost:` sizes an agent instance
  being spawned, and a command runs on whatever model the session is already using — and simply
  Task the tier-appropriate agent: **`cost: high`** agents (design,
  discovery, review) for front-loaded reasoning, **`cost: low, medium`** agents (planner, coder)
  for execution against the brief, reduced-depth at `low` only when the user set the session
  ceiling there. Tasking a differently-costed subagent from an uncosted orchestrator is the
  cache-correct way to mix tiers. See [Cost tiering](./AGENTS.md#cost-tiering).

## Model & tool grants

Commands declare what tools they expect to use. The default for SoMi commands is broad
(`Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch`). **Agents do not narrow this** — no SoMi
agent declares a `tools:` field, so every agent inherits full tool access. Review-type agents are
constrained by a **`## Write discipline` contract in their own prompt**, not by platform restriction; see
[`docs/AGENTS.md`](./AGENTS.md) for why that trade was made.

**Commands declare no `cost:` of their own, and no `model:` either** — `scripts/validate.sh` fails
the build if a command declares either field; a command runs on whatever model the session is
already using. The agent a command Tasks runs on its own **cost tier** — `cost: high` for high-cost agents
(design, discovery, review), `cost: low, medium` for the builder agents (planner, coder,
refactorer) — `low` selected whenever the session ceiling resolves there (an explicit CLI flag or
`SOMI_COST_CEILING`, a committed `.somi/config.json`, or persisted state), with the ceiling and its
source announced before work runs **when dispatched through the `somi` front door**. A direct
command invocation still Tasks its agent straight from that agent's own frontmatter `model:` and
does not call the resolver, so the ceiling has no effect on that path yet. See
[Cost tiering](./AGENTS.md#cost-tiering). Review commands (`/review`, `/security-review`,
`/architecture-review`, `/test-strategy`) still need `Write` and `Edit` to produce the review file
and append diary entries — they're not pure read-only at the command level even though the
underlying review agents are contractually forbidden from writing.

> **`/atlas` Tasks a `cost: high` agent for its entire job — `/discover`, `/design`, and
> `/refactor-design` don't, quite.** `/atlas` hands the whole task to the `atlas` agent: the read is
> the whole job, so there's nothing left for the command to do at a different tier. `/discover`,
> `/design`, and `/refactor-design` also Task a `cost: high` agent for the judgment-heavy core of
> the work (framing, reading the codebase, shaping crossroads) — their `brief.md` anchors the whole
> work item, so nothing about that core needs a lower tier — but each of those three commands keeps
> two things command-side: scaffolding the artifact set, and owning the crossroads conversation with
> the user (the `DECISIONS-NEEDED` / `VERIFIED-DECISIONS` round trip), which can't live inside a
> single `Task` call because a Tasked run can't pause to converse. That command-side work has no
> `cost:` to declare — a command has no referent for one — but it is real. `/adopt` Tasks the same
> `atlas` agent as its Stage 1 rather than reading the repo itself. All four still feed the
> high-cost front-load of the design→execution economy — intentional, not an oversight, and each
> `cost:` declaration lives on the agent Tasked, never on the command doing the Tasking.

## How `$ARGUMENTS` works

Anything the user types after `/command` is captured in `$ARGUMENTS` and inserted into the prompt.
Some commands also support positional args (`$1`, `$2`) — see Claude Code's command syntax docs.

> **Prompt-injection note:** commands that persist `$ARGUMENTS` into durable artifacts
> (`context.md`, `spec.md`, `diary.md`) fence it as `user-problem-statement` / `user-request`
> data so downstream agents reading the artifact treat the content as the subject of the work,
> not as instructions. If you add a new command that persists user text, follow the same pattern
> — see `commands/plan.md` and `commands/code.md` for examples.

## Adding a new command

1. Create `commands/<name>.md` with the frontmatter shape above. **No `cost:` field, and no
   `model:` field** — both belong on the agent this command Tasks, never on the command itself;
   `validate.sh` fails the build on a command that declares either. If the command does its own
   work rather than routing to another command, give it a paired `agents/<name>.md` and have the
   command Task it; that agent's own `cost:` and `model:` follow
   [`scripts/lib/cost-model.mjs`](../scripts/lib/cost-model.mjs).
2. Write the body as a prompt: validate, resolve, invoke, write, summarise. Fence persisted
   user input as data.
3. If the command writes artifacts inside `.somi/plans/<slug>/`, document the file naming convention.
4. Add a row to the table in this doc and a usage snippet in [USAGE.md](./USAGE.md).
5. Open a PR — CI validates frontmatter and compilation.

See [EXTENDING.md](./EXTENDING.md) for the full extensibility guide.

## Local commands

Project-specific commands live under your project's `.claude/commands/`. SoMi will not touch
them. Common project-local commands:

- `/db-migrate` — wrap your migration tool.
- `/seed` — wrap your seed data scripts.
- `/runbook <incident>` — generate an incident runbook.

## Running commands from other commands

A command body can invoke another command's workflow by calling the agent directly via Task, or
by Tasking another SoMi command. This is how `/ship` composes `/plan` + `/code-loop` per
iteration and how `/ship-loop` composes `/plan-loop` + `/code-loop` per iteration without
re-implementing their loop logic.
