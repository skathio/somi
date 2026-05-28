# Slash command reference

Every SoMi AI command is a Claude Code slash command defined under `commands/`. Commands are the
**user-facing entrypoints** to workflows; they orchestrate one or more agents and produce durable
artifacts inside `.somi/plans/<slug>/` and `.somi/reviews/<slug>/`.

## Command catalogue

| Command                                                  | Workflow            | Agent(s) invoked                                                                          | Output                                                                       |
|----------------------------------------------------------|---------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| [`/plan`](../commands/plan.md)                           | Planning            | `planner`                                                                                 | `.somi/plans/<slug>/` (context, spec, decisions, progress, diary, phases/)   |
| [`/plan-loop`](../commands/plan-loop.md)                 | Bounded planning    | `planner` + `reviewer`                                                                    | `.somi/plans/<slug>/` + plan reviews under `.somi/reviews/<slug>/`           |
| [`/code`](../commands/code.md)                           | Coding              | `coder`                                                                                   | diff + tests; updates `progress.md` + `diary.md`                             |
| [`/code-loop`](../commands/code-loop.md)                 | Bounded coding      | `coder` + `reviewer`                                                                      | diff + tests + per-pass review files; bounded by caps                        |
| [`/review`](../commands/review.md)                       | Reviewing           | `reviewer` (+ `security-reviewer` / `architecture-reviewer` / `test-strategist` per triggers) | `.somi/reviews/<slug>/<YYYY-MM-DD>-…md` (code or plan review)                |
| [`/security-review`](../commands/security-review.md)     | Security QA         | `security-reviewer`                                                                       | `.somi/reviews/<slug>/<YYYY-MM-DD>-security-…md`                             |
| [`/architecture-review`](../commands/architecture-review.md) | Architecture QA | `architecture-reviewer` (+ `security-reviewer` when relevant)                             | `.somi/reviews/<slug>/<YYYY-MM-DD>-arch-…md`                                 |
| [`/test-strategy`](../commands/test-strategy.md)         | Test-strategy QA    | `test-strategist`                                                                         | `.somi/reviews/<slug>/<YYYY-MM-DD>-test-strategy-…md`                        |
| [`/refactor`](../commands/refactor.md)                   | Refactoring         | `refactorer`                                                                              | diff (behavior-preserving)                                                   |
| [`/ship`](../commands/ship.md)                           | Full pipeline       | `planner` + (per iteration) `/code-loop`                                                  | full `.somi/plans/<slug>/` set + iteration diffs + reviews                   |
| [`/ship-loop`](../commands/ship-loop.md)                 | Bounded pipeline    | `/plan-loop` → `/code-loop` per iteration                                                 | as `/ship`, with both layers under caps and a hard human gate between them   |

> **Note:** `/plan-review` no longer exists as a separate command — plan-level review is part of
> `/review` (use `/review plan <slug>` or pass an `.somi/plans/<slug>/` path).

## Command file shape

Each command lives in `commands/<name>.md` with frontmatter:

```markdown
---
description: Short one-liner shown in / autocomplete.
argument-hint: <how to phrase arguments>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: sonnet
---

# /command-name — Title

The body of the command (the prompt that runs when the user types `/command-name`).
You can reference `$ARGUMENTS` to insert the user's argument string.
```

The command body is essentially a **prompt template**. It tells Claude what to do when the user
invokes the command. SoMi AI commands typically:

1. Validate input (ask the user if `$ARGUMENTS` is missing/unclear).
2. Resolve context — work-item slug, current iteration, target diff.
3. Invoke one or more agents via the Task tool.
4. Write artifacts under `.somi/plans/<slug>/` (the **command** owns the writes — read-only
   review agents return text; the command persists).
5. Update `progress.md` and `diary.md` as appropriate.
6. Summarise back with verdict + next step.

## Why commands are thin orchestrators

The heavy lifting lives in **agents**. Commands are deliberately small because:

- They're easy to read and modify.
- They make the workflow visible — a new team member can read `/plan.md` in 60 seconds and
  understand what the planner workflow does.
- They isolate orchestration from agent-internal behavior; you can swap an agent's prompt without
  touching the command.
- They run on `sonnet` (cheaper) while Tasking opus-tier agents that do the actual reasoning — the
  router/file-IO/summarize layer doesn't need the heavy tier.

## Default model & tool grants

Commands declare what tools they expect to use. The default for SoMi AI commands is broad
(`Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch`) — narrowing happens inside the agent
definitions, where each agent declares its own tools.

**All orchestration commands run on `sonnet`**; the agents they Task remain on `opus` where the
reasoning happens. Review commands (`/review`, `/security-review`, `/architecture-review`,
`/test-strategy`) still need `Write` and `Edit` to produce the review file and to append diary
entries — they're not pure read-only at the command level even though the underlying review agents
are read-only.

## How `$ARGUMENTS` works

Anything the user types after `/command` is captured in `$ARGUMENTS` and inserted into the prompt.
Some commands also support positional args (`$1`, `$2`) — see Claude Code's command syntax docs.

> **Prompt-injection note:** commands that persist `$ARGUMENTS` into durable artifacts
> (`context.md`, `spec.md`, `diary.md`) fence it as `user-problem-statement` / `user-request`
> data so downstream agents reading the artifact treat the content as the subject of the work,
> not as instructions. If you add a new command that persists user text, follow the same pattern
> — see `commands/plan.md` and `commands/code.md` for examples.

## Adding a new command

1. Create `commands/<name>.md` with the frontmatter shape above. Default `model: sonnet`.
2. Write the body as a prompt: validate, resolve, invoke, write, summarise. Fence persisted
   user input as data.
3. If the command writes artifacts inside `.somi/plans/<slug>/`, document the file naming convention.
4. Add a row to the table in this doc and a usage snippet in [USAGE.md](./USAGE.md).
5. Open a PR — CI validates frontmatter and compilation.

See [EXTENDING.md](./EXTENDING.md) for the full extensibility guide.

## Local commands

Project-specific commands live under your project's `.claude/commands/`. SoMi AI will not touch
them. Common project-local commands:

- `/db-migrate` — wrap your migration tool.
- `/seed` — wrap your seed data scripts.
- `/runbook <incident>` — generate an incident runbook.

## Running commands from other commands

A command body can invoke another command's workflow by calling the agent directly via Task, or
by Tasking another SoMi AI command. This is how `/ship` composes `/plan` + `/code-loop` per
iteration and how `/ship-loop` composes `/plan-loop` + `/code-loop` per iteration without
re-implementing their loop logic.
