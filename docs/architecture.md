# Architecture

How the pieces fit together. Read this when you want to understand *why* SOMI is shaped the way it is.

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
  → invokes Task[subagent_type=planner, prompt=<problem + context>]
  → planner reads repo (Read/Grep/Glob), composes plan
  → planner writes PLAN.md using templates/PLAN.md.tmpl as the shape
  → command summarises back to user with verdict + next step
```

### Coding

```
user: "/code <iteration>"
  → command /code reads PLAN.md, locates the requested iteration
  → invokes Task[subagent_type=coder, prompt=<iteration + context>]
  → coder reads relevant files
  → coder edits/writes code, runs tests via Bash
  → PreToolUse hooks may block dangerous operations
  → PostToolUse hooks lint changed files and audit-log every call
  → coder summarises: files changed, tests, not-done, tradeoffs
  → command surfaces summary, recommends /review
```

### Reviewing

```
user: "/review [target]"
  → command /review resolves target (diff, PR, file, plan)
  → invokes Task[subagent_type=reviewer, prompt=<target + plan + context>]
  → reviewer reads diff in surroundings, walks trust boundaries / abstractions / failure paths
  → reviewer may invoke Task[subagent_type=security-reviewer | architecture-reviewer | test-strategist]
  → reviewer aggregates findings, severity-grades them
  → reviewer writes REVIEW.md using templates/REVIEW.md.tmpl
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
| Artifact templates                       | `templates/`  | Shape of `PLAN.md`, `REVIEW.md`, etc.                                |
| Install profiles + manifest              | `install/`    | What components a given install includes                             |
| Install / update / validate / uninstall  | `scripts/`    | Bash scripts; one job each                                           |
| Plugin packaging                          | `.claude-plugin/` | Claude Code plugin manifest; marketplace manifest                |
| Project-default settings (hooks, perms)  | `.claude/`    | Reference settings used by the installer                             |

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

Subagents in Claude Code have their own context window and system prompt. SOMI uses subagents
because:

- Planning, coding, and reviewing are different shapes of work. Each benefits from a system prompt
  tuned to its quality bar and failure modes.
- Subagents let the orchestrating command **delegate** rather than absorb context. The reviewer
  doesn't pollute the coder's window.
- Multiple agents can run sequentially without context-window growth from accumulated tool output.

The trade-off: each subagent invocation starts cold. That's why agents are briefed with the
necessary context (the plan, the diff, the relevant repo paths) at the start of each invocation.

## Plugin shape vs. project install

SOMI supports both. The same `agents/`, `commands/`, `skills/`, `hooks/` directories serve both
modes:

- **Plugin install** (via marketplace): Claude Code's plugin runtime loads these directories
  directly. `${SOMI_ROOT}` resolves to the plugin's root.
- **Project install** (via `install.sh`): the script copies these directories under
  `.claude/plugins/somi-ai/`. The settings.json references them via `${SOMI_ROOT}` which is
  set in the install's `settings.json.env`.

The trick that makes both work: hook paths in `settings.json` always use `${SOMI_ROOT}/hooks/...`,
and `SOMI_ROOT` is set per install to point at the right directory.

## Audit story

Two artifacts let you reconstruct what the system did:

1. **`.claude/audit.log`** — every tool call (PostToolUse hook). Useful for "what files did the agent
   touch / what bash did it run?"
2. **`PLAN.md` + `REVIEW.md`** — the workflow artifacts. Useful for "what was the plan, what did the
   review find?"

Together, they're enough to retrace any session. Don't gitignore `PLAN.md` / `REVIEW.md` by default —
they're often worth committing alongside the feature branch.

## What SOMI deliberately doesn't do

- **It doesn't replace humans in the loop.** Every workflow stops at decision points.
- **It doesn't ship with project-specific knowledge.** That belongs in `99-overrides.md` or in a
  project-local plugin.
- **It doesn't try to be a CI system.** Validation scripts catch repo-level issues; CI is your job.
- **It doesn't lock you in.** `uninstall.sh` removes everything SOMI-managed; your artifacts persist.
