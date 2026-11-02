# Skills

Skills are **on-demand expert knowledge packs**. They live under `skills/` as `SKILL.md` files with
frontmatter, and are pulled into context only when the work clearly enters their domain. They are
not a replacement for the global ruleset; they're depth-on-demand.

## What SoMi ships

| Skill                                                          | Use when                                                                          |
|----------------------------------------------------------------|-----------------------------------------------------------------------------------|
| [`rules`](../skills/rules/SKILL.md)                            | Loading a full numbered rules file (`00`-`50`) on-demand once its domain is engaged; finding where a project's local overrides live |
| [`market-research`](../skills/market-research/SKILL.md)        | Researching a software idea: competitors, complaints, churn, failure modes to avoid |
| [`requirements-engineering`](../skills/requirements-engineering/SKILL.md) | Writing/critiquing BRD/SRS/FRD/SDD/TDD; turning an idea into testable, traceable requirements |
| [`owasp-defense`](../skills/owasp-defense/SKILL.md)            | Auth, crypto, input validation at trust boundaries, deserialization, file uploads |
| [`solid-principles`](../skills/solid-principles/SKILL.md)      | Designing a module, naming a class, evaluating an abstraction                     |
| [`plan-review`](../skills/plan-review/SKILL.md)                | Judging whether a plan, brief, or ADR is sound before code is written             |
| [`sdlc-process`](../skills/sdlc-process/SKILL.md)              | Checking that progress, diary, decisions, and findings match the repository       |
| [`clean-code`](../skills/clean-code/SKILL.md)                  | Naming, function structure, comments, errors                                      |
| [`testing-playbook`](../skills/testing-playbook/SKILL.md)      | Choosing test level, mock policy, deciding what to skip                           |
| [`api-design`](../skills/api-design/SKILL.md)                  | HTTP/gRPC/library APIs, versioning, idempotency, error shapes                     |
| [`observability`](../skills/observability/SKILL.md)            | Logs, metrics, traces, alerting philosophy                                        |
| [`threat-modeling`](../skills/threat-modeling/SKILL.md)        | New attack surface: webhook, OAuth, file upload, new service                      |
| [`reasoning-craft`](../skills/reasoning-craft/SKILL.md)        | Before answering a substantive question, or self-editing a draft for hedging and bland phrasing |
| [`somi-routing`](../skills/somi-routing/SKILL.md)              | Classifying a free-form request into the right SoMi command, and sizing it (`trivial` / `small` / `full`) — used by the `somi` agent (Copilot's front door) and `/ship-loop` |
| [`somi-dispatch`](../skills/somi-dispatch/SKILL.md)            | Resolving and starting a SoMi agent's dispatch tier/model — shared by every command that Tasks an agent and the `somi` agent |
| [`somi-checkpoint`](../skills/somi-checkpoint/SKILL.md)        | A user gate inside a subagent: the `CHECKPOINT` / `RESUME` contract and the `DONE` / `STOPPED` / `REROUTE` result blocks — used by `somi-flow`, `somi-general` and the `somi` dispatcher |

## Workflow procedures

Every workflow's procedure is a skill named `flow-<command>`: [`flow-adopt`](../skills/flow-adopt/SKILL.md), [`flow-architecture-review`](../skills/flow-architecture-review/SKILL.md), [`flow-atlas`](../skills/flow-atlas/SKILL.md), [`flow-code`](../skills/flow-code/SKILL.md), [`flow-code-loop`](../skills/flow-code-loop/SKILL.md), [`flow-code-parallel`](../skills/flow-code-parallel/SKILL.md), [`flow-debug`](../skills/flow-debug/SKILL.md), [`flow-design`](../skills/flow-design/SKILL.md), [`flow-discover`](../skills/flow-discover/SKILL.md), [`flow-impact`](../skills/flow-impact/SKILL.md), [`flow-incident`](../skills/flow-incident/SKILL.md), [`flow-plan`](../skills/flow-plan/SKILL.md), [`flow-plan-loop`](../skills/flow-plan-loop/SKILL.md), [`flow-pr`](../skills/flow-pr/SKILL.md), [`flow-refactor`](../skills/flow-refactor/SKILL.md), [`flow-refactor-design`](../skills/flow-refactor-design/SKILL.md), [`flow-release-readiness`](../skills/flow-release-readiness/SKILL.md), [`flow-review`](../skills/flow-review/SKILL.md), [`flow-review-panel`](../skills/flow-review-panel/SKILL.md), [`flow-security-review`](../skills/flow-security-review/SKILL.md), [`flow-ship`](../skills/flow-ship/SKILL.md), [`flow-ship-loop`](../skills/flow-ship-loop/SKILL.md), [`flow-somi-config`](../skills/flow-somi-config/SKILL.md), [`flow-status`](../skills/flow-status/SKILL.md) (the dashboard; no command), [`flow-test-strategy`](../skills/flow-test-strategy/SKILL.md), [`flow-upgrade`](../skills/flow-upgrade/SKILL.md).

The command (`commands/<name>.md`) is a thin wrapper that loads its flow skill in the main conversation; the [`somi-flow`](../agents/somi-flow.md) runner loads the same skill when the `somi` dispatcher starts the workflow as a subagent. One procedure, two entry points, so neither can drift from the other. Flow skills are `user-invocable: false` and carry a one-line description, because they are loaded by name rather than chosen by the model.

## Role procedures

The heavy agents keep only their role in `agents/<name>.md` — who they are, their tier and what they trim at `low`, their write contract — and load their working procedure from a `role-<agent>` skill at the start of every run: [`role-coder`](../skills/role-coder/SKILL.md), [`role-designer`](../skills/role-designer/SKILL.md), [`role-discovery-analyst`](../skills/role-discovery-analyst/SKILL.md), [`role-planner`](../skills/role-planner/SKILL.md), [`role-reviewer`](../skills/role-reviewer/SKILL.md). An agent that cannot load its role skill stops and says so rather than improvising. The knowledge skills above stay separate: a role skill says how the agent works, a knowledge skill says what good looks like in a domain.

## When to invoke a skill

Skills should be pulled in when the **domain is clearly engaged**, not speculatively. Invoking a skill
costs context window; invoking the wrong skill costs accuracy. Some rules of thumb:

- **Domain is engaged**: the change actually touches the skill's territory (a new HTTP endpoint
  engages `api-design`; a new webhook engages `owasp-defense` + `threat-modeling`).
- **Decision is non-trivial**: the change involves a judgment call within the domain (deciding how to
  mock an external service engages `testing-playbook`).
- **Pattern matches a known anti-pattern**: the existing code is producing a smell from the skill's
  list (engaging `solid-principles` or `clean-code`).

Don't invoke speculatively. Don't pull `owasp-defense` into a CSS-only change.

## Skills vs. rules vs. agents

| Layer    | Lifetime in context  | Granularity            | Best for                                                |
|----------|----------------------|------------------------|---------------------------------------------------------|
| Rules    | Always loaded       | Universal              | Priorities, conflict resolution, project-wide invariants |
| Skills   | On-demand           | Domain-specific        | Operational checklists, patterns, anti-patterns         |
| Agents   | On-demand (subagent) | Workflow-specific       | Multi-step thinking with their own system prompt        |

You can think of it as:
- **Rules**: "what we always believe."
- **Skills**: "what we know about this specific domain."
- **Agents**: "how we think through this specific shape of problem."

### Rules vs. skills — no duplication

Skills are **operational depth on top of rules**, not a restatement. Each SoMi skill links to
its corresponding rule(s) at the top and adds only what the rule doesn't already say (examples,
decision tables, before/after pairs, anti-patterns). When you edit a skill, ask: "is this line
already in the rule?" — if yes, replace it with a pointer instead of mirroring it. Keeping both
files in lockstep by hand is drift bait; pointers don't drift.

## Skill file shape

```markdown
---
name: skill-name
description: Use when ... (one or two sentences describing the trigger conditions)
---

# Skill title

(Body of the skill — operational guidance, examples, anti-patterns, when-not-to-apply.)
```

The `description` field is critical: it determines whether the model decides to load this skill. Write
descriptions that name the **trigger conditions**, not the topic.

- **Good**: "Use when adding/changing an HTTP/gRPC API. Covers resource modeling, error shapes,
  versioning, idempotency."
- **Bad**: "API design knowledge."

## Adding a new skill

1. Create `skills/<skill-name>/SKILL.md` with the frontmatter above.
2. The body should include:
   - **When to invoke** (trigger conditions, in plain language).
   - **Operating procedure** or **first principles** (the thinking moves).
   - **Per-domain checklists** or examples.
   - **Anti-patterns to call out** (so the model recognises them).
   - **When *not* to apply** (boundaries — keeps the skill honest).
   - **When to escalate** (to which agent).
3. Add a row to the table in this doc.
4. Open a PR — CI validates the frontmatter.

## Linking skills together

Skills can reference each other with `[[skill-name]]` or direct markdown links. SoMi skills do this
when one domain calls into another:

- `api-design` references `owasp-defense` for security touchpoints.
- `threat-modeling` references `owasp-defense` for mitigations.
- `clean-code` references `testing-playbook` (untestable code is often badly-coupled code).
- `testing-playbook` references `somi-refactorer` (when a test-shape problem is really a design problem).
- `market-research` references `requirements-engineering` (every research finding must become a
  requirement, non-goal, or risk).
- `requirements-engineering` references `solid-principles`, `api-design`, and `threat-modeling` for
  the high-level design (SDD/TDD) portion of discovery.

## Local skills

Project-specific skills can live under your project's `.claude/skills/`. They are loaded with the
same triggering rules as SoMi skills. SoMi will not touch project-local skills during install/update.

A common pattern: a `skills/<project>-conventions/SKILL.md` that captures project idioms — HTTP error
envelope, repository layout, logging vocabulary. Pulled in when a new module is being designed.

## Why skills aren't always loaded

Two reasons:

1. **Context window cost**. Loading every skill on every turn drowns out the actual task.
2. **Accuracy**. The model performs better when the loaded knowledge matches the task. A `clean-code`
   skill pulled into a planning task is noise.

The trade-off: the model must decide when to load a skill. Good `description` fields make this
reliable. Misleading or vague descriptions don't.
