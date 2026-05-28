# Skills

Skills are **on-demand expert knowledge packs**. They live under `skills/` as `SKILL.md` files with
frontmatter, and are pulled into context only when the work clearly enters their domain. They are
not a replacement for the global ruleset; they're depth-on-demand.

## What SoMi AI ships

| Skill                                                          | Use when                                                                          |
|----------------------------------------------------------------|-----------------------------------------------------------------------------------|
| [`owasp-defense`](../skills/owasp-defense/SKILL.md)            | Auth, crypto, input validation at trust boundaries, deserialization, file uploads |
| [`solid-principles`](../skills/solid-principles/SKILL.md)      | Designing a module, naming a class, evaluating an abstraction                     |
| [`clean-code`](../skills/clean-code/SKILL.md)                  | Naming, function structure, comments, errors                                      |
| [`test-strategy`](../skills/test-strategy/SKILL.md)            | Choosing test level, mock policy, deciding what to skip                           |
| [`api-design`](../skills/api-design/SKILL.md)                  | HTTP/gRPC/library APIs, versioning, idempotency, error shapes                     |
| [`observability`](../skills/observability/SKILL.md)            | Logs, metrics, traces, alerting philosophy                                        |
| [`threat-modeling`](../skills/threat-modeling/SKILL.md)        | New attack surface: webhook, OAuth, file upload, new service                      |

## When to invoke a skill

Skills should be pulled in when the **domain is clearly engaged**, not speculatively. Invoking a skill
costs context window; invoking the wrong skill costs accuracy. Some rules of thumb:

- **Domain is engaged**: the change actually touches the skill's territory (a new HTTP endpoint
  engages `api-design`; a new webhook engages `owasp-defense` + `threat-modeling`).
- **Decision is non-trivial**: the change involves a judgment call within the domain (deciding how to
  mock an external service engages `test-strategy`).
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

Skills are **operational depth on top of rules**, not a restatement. Each SoMi AI skill links to
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

Skills can reference each other with `[[skill-name]]` or direct markdown links. SoMi AI skills do this
when one domain calls into another:

- `api-design` references `owasp-defense` for security touchpoints.
- `threat-modeling` references `owasp-defense` for mitigations.
- `clean-code` references `test-strategy` (untestable code is often badly-coupled code).
- `test-strategy` references `refactorer` (when a test-shape problem is really a design problem).

## Local skills

Project-specific skills can live under your project's `.claude/skills/`. They are loaded with the
same triggering rules as SoMi AI skills. SoMi AI will not touch project-local skills during install/update.

A common pattern: a `skills/<project>-conventions/SKILL.md` that captures project idioms — HTTP error
envelope, repository layout, logging vocabulary. Pulled in when a new module is being designed.

## Why skills aren't always loaded

Two reasons:

1. **Context window cost**. Loading every skill on every turn drowns out the actual task.
2. **Accuracy**. The model performs better when the loaded knowledge matches the task. A `clean-code`
   skill pulled into a planning task is noise.

The trade-off: the model must decide when to load a skill. Good `description` fields make this
reliable. Misleading or vague descriptions don't.
