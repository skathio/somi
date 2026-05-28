---
description: Targeted security review of the current changes (or a specified diff). Walks trust boundaries to sinks, applies OWASP Top 10 lens, produces severity-graded findings with explicit attack paths. Output lands under .somi/reviews/<slug>/ when scoped to a work item.
argument-hint: <slug> | <diff range> | <PR #> | <file path>
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit, WebFetch
model: sonnet
---

# /security-review — Targeted security review

You are running a **security-only** review using somi-ai.

Target: **$ARGUMENTS** (empty = current working-tree diff vs. default branch, scoped to a single
in-progress work item if exactly one exists).

## What to do

### 1. Resolve the target

Use the same resolution logic as [`/review`](./review.md):

- **A work-item slug** → review the latest iteration's diff, scoped to security.
- **Empty / range / PR / file** → resolve as in `/review`.

### 2. Brief the `security-reviewer` agent

Via the Task tool, pass:

- The diff and the relevant repo context.
- The work-item paths (`spec.md` §8 security considerations, the iteration phase file, recent
  `diary.md` entries) when scoped.
- The expectation: walk trust boundaries to sinks, produce **attack-path-grounded** findings.

### 3. Findings must include

- **Attack path** — end-to-end, in plain language (entrypoint → intermediate steps → sink).
- **Preconditions** — what the attacker needs (auth, network access, specific input shape).
- **Mitigation** — concrete code/config change, not a homily.
- **Defense-in-depth** — a second layer if the primary fails.

### 4. Write the review

Filename pattern: `<YYYY-MM-DD>-security-<phase>.<iter>-<verdict>.md` under
`.somi/reviews/<slug>/` when scoped to a work item, or `.somi/reviews/_ad-hoc/` otherwise.

Use [`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl) with security framing.

### 5. Update work-item state (if scoped)

- `progress.md`: line under "Recent activity" referencing the security review file and verdict.
- If a Blocker / Major finding requires a plan change (e.g., reveals a missing mitigation in
  `spec.md` §8), append a diary entry with category `review-feedback`. The follow-up `/code`
  invocation will pick up the changes via the plan-change protocol.

### 6. Summarise back

- **Verdict** (`approve` / `request-changes` / `reject`).
- Count of Blockers / Majors / Minors.
- Top 3 findings with their attack paths.
- Pointer to the review file.

## When to invoke

Always when the change touches: authentication, authorization, cryptography, secrets, input
validation at trust boundaries, deserialization, file uploads, template rendering, outbound HTTP
triggered by user input, or third-party SDK calls with user-controlled arguments.

## Guardrails

- **Concrete attack paths only.** "X could be vulnerable to injection" is not a finding. "An
  unauthenticated user can POST `{...}` to `/api/...`, which reaches sink `S` because of code path
  `P`" is.
- **Verify against the codebase.** Don't recite CVEs without tracing them in this code.
- **Don't bury Blockers in a list of Nits.** RCEs go at the top.
