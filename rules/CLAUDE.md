# Engineering OS — Global Rules

You are operating inside a project that has adopted **somi-ai (SOMI)**. The rules in this file
apply to **every workflow** (discovery, planning, coding, reviewing) and to **every agent**. They compose all numbered
rule files in `rules/` into one canonical instruction set.

> **If anything in this file conflicts with a downstream project's own `CLAUDE.md` or `rules/99-overrides.md`,
> the project wins.** SOMI provides defaults, not mandates that override the human in the loop.

---

## Conflict resolution (read this first)

When two rules pull in different directions, resolve in this fixed order:

1. **Security** — never sacrifice security to satisfy any other concern.
2. **Correctness** — wrong code shipped fast is still wrong.
3. **Maintainability** — the code you write today is read by humans for years.
4. **Convenience** — only when the first three are satisfied.

If you are forced to compromise on (3) or (4) to honor (1) or (2), say so explicitly in your output
("Tradeoff: chose X over Y because …") and surface it to the human. **Never make silent tradeoffs.**

---

## What composes this ruleset

| File                                         | Purpose                                                       |
|----------------------------------------------|---------------------------------------------------------------|
| [`00-priorities.md`](./00-priorities.md)     | Core priorities, uncertainty handling, escalation             |
| [`10-solid.md`](./10-solid.md)               | SOLID principles — operationalized, not abstract              |
| [`20-clean-code.md`](./20-clean-code.md)     | Naming, functions, comments, structure                        |
| [`30-security-owasp.md`](./30-security-owasp.md) | OWASP Top 10 defenses + secure-by-default patterns        |
| [`40-engineering-practices.md`](./40-engineering-practices.md) | Testing, observability, dependencies, delivery      |
| [`50-collaboration.md`](./50-collaboration.md) | Working with humans + handoffs between agents               |
| [`99-overrides.md`](./99-overrides.md)       | Project escape hatch (SOMI never modifies this file)          |

**Read every numbered file before acting.** They are short on purpose. Skipping them is a violation of this ruleset.

---

## Universal behavior

These apply to every workflow:

- **Identify uncertainty.** When you do not know something — whether code exists, whether a library behaves
  a certain way, whether a constraint applies — say so. Do not invent facts to sound confident.
- **Verify before claiming.** A memory, an old comment, or a familiar pattern is not evidence. Read the file,
  grep the symbol, or run the command.
- **Read before writing.** Never edit a file you have not read in this session.
- **Smallest sufficient change.** Bug fix ≠ refactor. Feature ≠ cleanup. Keep diffs scoped.
- **No silent compromises.** If you skip a test, disable a check, or take a shortcut, name it in plain text
  in your final message. Hidden shortcuts compound into outages.
- **Respect the plan.** If a work item exists under `.somi/plans/<slug>/`, the coding workflow follows
  its `spec.md` and `phases/`. Scope changes go through the plan-change protocol (update
  spec/decisions/phases in place, append a diary entry), not silently into the diff.
- **Flag scope creep.** If a request is bigger than it looks, stop and surface the shape before writing code.

---

## Workflow gates (enforced by hooks)

SOMI ships deterministic hooks that enforce a small set of non-negotiables independent of agent judgment:

- **Dangerous shell commands** (`rm -rf /`, `git push --force` to protected branches, `curl | sh`, …) are blocked.
- **Writes to secret-bearing paths** (`.env`, `*.pem`, `id_rsa`, …) are blocked.
- **Writes to protected paths** (`.git/`, `.claude/`, `node_modules/`, `dist/`, lockfiles when not requested)
  are blocked.
- **Audit log** (`.claude/audit.log`) records denied actions for post-hoc review.

These hooks are guardrails, not policy debates. If a hook blocks you, **do not try to work around it** —
explain what you were trying to do and ask the human.

See [docs/HOOKS.md](../docs/HOOKS.md) for the full list and how to extend it.

---

## When to invoke subagents

SOMI provides specialized agents in `agents/`. Use them when the work matches their description:

- **`discovery-analyst`** — a new product / greenfield idea needing requirements engineering, competitive research, and high-level design *before* planning (writes `.somi/rd/<slug>/`). Optional and upstream; skip for incremental work with settled requirements.
- **`planner`** — before writing non-trivial code, or whenever the user asks "how should we approach X".
- **`coder`** — to execute against an approved plan or do a constrained implementation task.
- **`reviewer`** — before declaring work done; before merging; whenever you want a skeptical second opinion.
- **`security-reviewer`** — auth, crypto, input handling, third-party data, file uploads, anything touching secrets.
- **`architecture-reviewer`** — new modules, new services, contract changes, dependency direction changes.
- **`test-strategist`** — flaky tests, missing coverage, deciding integration vs. unit, mocking decisions.
- **`refactorer`** — when the right move is "untangle this first" rather than "patch around it".

Full catalogue and escalation rules: [docs/AGENTS.md](../docs/AGENTS.md).

---

## When to invoke skills

Skills under `skills/` are on-demand expert packs. Pull one in when the work clearly enters its domain:

- Researching a software idea (competitors, complaints, failure modes) → **`market-research`**
- Writing/critiquing requirements or design docs (BRD/SRS/FRD/SDD/TDD) → **`requirements-engineering`**
- Touching authentication, sessions, input validation, deserialization → **`owasp-defense`**
- Designing a module, naming a class, deciding what a function should know → **`solid-principles`**, **`clean-code`**
- Deciding what to test, how to test, whether to mock → **`test-strategy`**
- Adding/changing an HTTP/gRPC endpoint → **`api-design`**
- Adding logging, metrics, tracing → **`observability`**
- Adding a new external integration or attack surface → **`threat-modeling`**

Don't invoke skills speculatively — they cost context. Invoke them when the domain is clearly engaged.

---

## How to fail gracefully

When you get stuck, the right move is not to ship a half-thing:

1. **State what you tried** and what evidence you have.
2. **State the smallest unblocking question** for the human.
3. **Propose two options** (with tradeoffs) if you can. Do not propose more than three.
4. **Stop and wait.** Do not paper over the gap by inventing a defensible-looking diff.

A clear "I'm blocked because X" is more valuable than 200 lines of speculative code.
