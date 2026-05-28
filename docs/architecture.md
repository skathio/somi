# Architecture

How the pieces fit together. Read this when you want to understand *why* SoMi AI is shaped the way it is.

## The four layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  USER                                                                │
│   types /plan, /code, /review, /ship, …                              │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  COMMANDS (thin orchestrators)                                       │
│   commands/*.md — validate input, invoke agents, write artifacts     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  AGENTS (judgment-heavy thinking)                                    │
│   agents/*.md — planner, coder, reviewer, + support agents           │
│                                                                      │
│   Each agent: its own system prompt, tool set, quality bar.          │
└──────────────────────────────────────────────────────────────────────┘
                              │             ▲
                              │             │ may invoke
                              ▼             │
┌──────────────────────────────────────────────────────────────────────┐
│  SKILLS  +  RULES  +  HOOKS                                          │
│                                                                      │
│   SKILLS  → on-demand domain knowledge (OWASP, SOLID, test, …)       │
│   RULES   → always-loaded global ruleset (CLAUDE.md composed)        │
│   HOOKS   → deterministic guardrails (block, lint, audit, inject)    │
└──────────────────────────────────────────────────────────────────────┘
```

Each layer has a clear job:

- **Commands** are user-facing entrypoints. They are deliberately thin so the workflow is readable.
- **Agents** do the thinking. Each agent has its own system prompt and is invoked via the Task tool.
- **Skills + rules + hooks** are the substrate that shapes both commands and agents — universal
  priors (rules), domain-specific depth (skills), and non-negotiable guardrails (hooks).

## Data flow per workflow

### Planning

```
user: "/plan <problem>"
  → command /plan reads $ARGUMENTS, validates non-empty
  → command derives slug, scaffolds .somi/plans/<slug>/ from templates/
  → invokes Task[subagent_type=planner, prompt=<problem + slug + paths + context>]
  → planner reads repo (Read/Grep/Glob), drafts context.md, then spec skeleton
  → planner PAUSES on each architectural decision: presents 2–4 concrete options with
    pros/cons, recommends one, offers Other / Discover escape hatches
  → user-verified decisions recorded in decisions.md (with discovery Q&A if used)
  → planner writes phases/, initializes progress.md (awaiting-approval), seeds diary.md
  → command summarises back: phase count, top risks, top open questions, pointer to
    .somi/plans/<slug>/ + next step
```

### Coding

```
user: "/code <slug> [phase N, iteration M]"
  → command /code resolves work item, reads spec.md + phases/<NN>-*.md + recent diary
  → marks iteration in-progress in progress.md
  → invokes Task[subagent_type=coder, prompt=<iteration + slug + paths + context>]
  → coder reads relevant files in the repo
  → coder edits/writes code, runs tests via Bash
  → PreToolUse hooks may block dangerous operations
  → PostToolUse hooks lint changed files and audit-log every call
  → IF coder discovers plan needs to change:
    → updates spec/decisions(supersede)/phases/progress in place
    → appends a diary.md entry (plan-change / decision-change / blocker)
    → surfaces to user before continuing
  → coder marks iteration done, updates progress.md, appends diary note
  → coder summarises: files, tests, plan changes, not-done, tradeoffs, what to look at
  → command surfaces summary, recommends /review <slug>
```

### Reviewing

```
user: "/review <slug>" (or working tree / range / PR / plan)
  → command /review resolves target and work-item context
  → invokes Task[subagent_type=reviewer, prompt=<target + spec + phases + diary + context>]
  → reviewer reads diff in surroundings, walks trust boundaries / abstractions / failure paths
  → reviewer checks plan-vs-code alignment (scope drift, missing diary entries, accuracy of
    progress.md, decisions silently contradicted)
  → reviewer may invoke Task[subagent_type=security-reviewer | architecture-reviewer | test-strategist]
  → reviewer aggregates findings, severity-grades them
  → reviewer writes review file at .somi/reviews/<slug>/<YYYY-MM-DD>-…md using
    templates/REVIEW.md.tmpl
  → progress.md "Recent activity" gets a line; diary.md gets a review-feedback entry if
    findings affect the plan
  → command surfaces verdict + top 3 findings
```

### `/ship`

Same as the three above, with explicit human-in-the-loop gates between stages. The orchestration
lives in `commands/ship.md`; the agents are unchanged.

## What lives where, and why

| Concern                                  | Where         | Why                                                                  |
|------------------------------------------|---------------|----------------------------------------------------------------------|
| Universal priors (priorities, SOLID, OWASP) | `rules/`    | Always loaded; small enough to read; numbered for explicit composition |
| Domain knowledge with triggers           | `skills/`     | Loaded on-demand by the model; rich; not always relevant             |
| Workflow-specific thinking process       | `agents/`     | Subagent system prompts; can have their own tool sets                |
| User-facing entrypoints                  | `commands/`   | Slash-command shape; thin orchestrators                              |
| Deterministic guardrails                 | `hooks/`      | Runs in Claude Code's hook framework; no model involved              |
| Artifact templates                       | `templates/`  | Shape of `context.md`, `spec.md`, `decisions.md`, `phases/*.md`, `progress.md`, `diary.md`, review files |
| Work-item artifacts (per project)        | `.somi/plans/<slug>/` | One subdir per work item; persists indefinitely; user-controlled retention |
| Claude Code plugin packaging             | `.claude-plugin/` | Plugin manifest; marketplace manifest for `/plugin install`      |
| Copilot extension packaging              | `.copilot-extension/` | Extension manifest; marketplace manifest for `copilot plugin install` |
| Project-default settings (hooks, perms)  | `.claude/`    | Reference settings loaded by the plugin runtime                      |

## Why split rules, skills, and hooks the way we did

- **Rules** are universal — they apply to every interaction. They must be small enough to always have
  in context. They encode the floor (priorities, SOLID, OWASP, clean code, engineering practices,
  collaboration norms).
- **Skills** are domain-specific — they apply only when the work clearly enters their domain. They
  can be richer because they're loaded selectively. They encode operational depth (OWASP checklists
  tied to sinks, API design patterns, test-strategy frameworks).
- **Hooks** are non-negotiable — they don't depend on the model deciding the right thing. They
  encode policy that should be deterministic (no `rm -rf /`, no committing secrets, no `git push
  --force` to main).

The split makes each layer **independently maintainable**: you can tighten a hook without changing
agents; you can add a skill without modifying rules; you can swap an agent's prompt without touching
the rest of the system.

## Why agents instead of just prompts

Subagents in Claude Code have their own context window and system prompt. SoMi AI uses subagents
because:

- Planning, coding, and reviewing are different shapes of work. Each benefits from a system prompt
  tuned to its quality bar and failure modes.
- Subagents let the orchestrating command **delegate** rather than absorb context. The reviewer
  doesn't pollute the coder's window.
- Multiple agents can run sequentially without context-window growth from accumulated tool output.

The trade-off: each subagent invocation starts cold. That's why agents are briefed with the
necessary context (the plan, the diff, the relevant repo paths) at the start of each invocation.

## Plugin shape

The same `agents/`, `commands/`, `skills/`, `hooks/` directories are shared by all three
distribution paths:

- **Claude Code plugin** (marketplace): the plugin runtime loads these directories directly.
  Hook paths in [`hooks/hooks.json`](../hooks/hooks.json) use `${CLAUDE_PLUGIN_ROOT}`, which the
  harness resolves to the plugin install root.
- **Claude Code vendored** (`.claude/plugins/somi-ai/`): the project's own `.claude/settings.json`
  merges the hooks block from [`.claude/settings.json`](../.claude/settings.json) in this repo,
  using `${SOMI_VENDOR_ROOT}` to point at the hook scripts.
- **GitHub Copilot extension** (Copilot marketplace): the same directories are referenced from
  `.copilot-extension/extension.json`. Both manifests point at identical source files — no
  content is duplicated.

## Audit story

Two artifacts let you reconstruct what the system did:

1. **`.claude/audit.log`** — every tool call (PostToolUse hook). Useful for "what files did the
   agent touch / what bash did it run?"
2. **`.somi/plans/<slug>/`** — the full per-work-item artifact set: context, spec, decisions (with
   superseded history), phases, progress, diary, reviews. Useful for "what did we decide, what
   changed, why, and what did review find?"

Together, they're enough to retrace any session — not just what files changed, but *why* the plan
took the shape it did and how it evolved. Commit `.somi/` alongside the feature branch; it's the
durable record of the work.

## What SoMi AI deliberately doesn't do

- **It doesn't replace humans in the loop.** Every workflow stops at decision points.
- **It doesn't ship with project-specific knowledge.** That belongs in `99-overrides.md` or in a
  project-local plugin.
- **It doesn't try to be a CI system.** Validation scripts catch repo-level issues; CI is your job.
- **It doesn't lock you in.** `/plugin uninstall somi-ai` removes the plugin; your artifacts under `.somi/` and `audit.log` persist — they're plain markdown files, readable without the plugin.
- **It doesn't auto-archive.** Work items stay in `.somi/` indefinitely. Only humans delete from `.somi/`. Status lives in `progress.md`, not in directory location.
