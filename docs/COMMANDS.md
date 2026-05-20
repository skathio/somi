# Slash command reference

Every SOMI command is a Claude Code slash command defined under `commands/`. Commands are the
**user-facing entrypoints** to workflows; they orchestrate one or more agents and produce durable
artifacts.

## Command catalogue

| Command                                | Workflow      | Agent(s) invoked                                     | Output artifact          |
|----------------------------------------|---------------|------------------------------------------------------|--------------------------|
| [`/plan`](../commands/plan.md)         | Planning      | `planner`                                            | `PLAN.md`                |
| [`/code`](../commands/code.md)         | Coding        | `coder`                                              | diff + tests             |
| [`/review`](../commands/review.md)     | Reviewing     | `reviewer` (+ `security-reviewer`/`architecture-reviewer` when relevant) | `REVIEW.md`              |
| [`/ship`](../commands/ship.md)         | Full pipeline | all three core agents                                | `PLAN.md` + diff + `REVIEW.md` |
| [`/plan-review`](../commands/plan-review.md) | Plan QA | `reviewer` (+ `architecture-reviewer` when relevant) | `PLAN-REVIEW.md`         |
| [`/security-review`](../commands/security-review.md) | Security QA | `security-reviewer`                  | `SECURITY-REVIEW.md`     |
| [`/refactor`](../commands/refactor.md) | Refactoring   | `refactorer`                                         | diff (behavior-preserving) |

## Command file shape

Each command lives in `commands/<name>.md` with frontmatter:

```markdown
---
description: Short one-liner shown in / autocomplete.
argument-hint: <how to phrase arguments>
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: opus
---

# /command-name — Title

The body of the command (the prompt that runs when the user types `/command-name`).
You can reference `$ARGUMENTS` to insert the user's argument string.
```

The command body is essentially a **prompt template**. It tells Claude what to do when the user invokes
the command. SOMI commands typically:

1. Validate input (ask the user if `$ARGUMENTS` is missing/unclear).
2. Resolve context (read `PLAN.md`, locate the diff, etc.).
3. Invoke one or more agents via the Task tool.
4. Write an artifact.
5. Summarise back with verdict + next step.

## Why commands are thin orchestrators

The heavy lifting lives in **agents**. Commands are deliberately small because:

- They're easy to read and modify.
- They make the workflow visible — a new team member can read `/plan.md` in 60 seconds and understand
  what the planner workflow does.
- They isolate orchestration from agent-internal behavior; you can swap an agent's prompt without
  touching the command.

## Default model & tool grants

Commands declare what tools they expect to use. The default for SOMI commands is broad
(`Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch`) — narrowing happens inside the agent
definitions, where each agent declares its own tools.

`/review`, `/plan-review`, `/security-review` use read-only tool sets to make the command's
intent unambiguous.

## How `$ARGUMENTS` works

Anything the user types after `/command` is captured in `$ARGUMENTS` and inserted into the prompt.
Some commands also support positional args (`$1`, `$2`) — see Claude Code's command syntax docs.

## Adding a new command

1. Create `commands/<name>.md` with the frontmatter shape above.
2. Write the body as a prompt: validate, resolve, invoke, write, summarise.
3. Add it to the install profile.
4. Add a row to the table in this doc and a usage snippet in [USAGE.md](./USAGE.md).
5. Run `scripts/validate.sh`.

See [EXTENDING.md](./EXTENDING.md) for the full extensibility guide.

## Local commands

Project-specific commands live under your project's `.claude/commands/`. SOMI will not touch them.
Common project-local commands:

- `/db-migrate` — wrap your migration tool.
- `/seed` — wrap your seed data scripts.
- `/runbook <incident>` — generate an incident runbook.

## Running commands from other commands

A command body can invoke another command's workflow by calling the agent directly via Task. This is
how `/ship` orchestrates `/plan` + `/code` + `/review` without re-defining their bodies.
