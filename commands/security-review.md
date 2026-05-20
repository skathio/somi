---
description: Targeted security review of the current changes (or a specified diff). Walks trust boundaries to sinks, applies OWASP Top 10 lens, produces severity-graded findings with explicit attack paths.
argument-hint: <optional: diff range, PR number, or file path>
allowed-tools: Task, Read, Grep, Glob, Bash, WebFetch
model: opus
---

# /security-review — Targeted security review

You are running a **security-only** review using somi-ai.

Target: **$ARGUMENTS** (empty = current working-tree diff vs. default branch).

## What to do

1. **Resolve the target** — see [`/review`](./review.md) for resolution logic.
2. **Brief the `security-reviewer` agent** ([`agents/security-reviewer.md`](../agents/security-reviewer.md))
   with the diff and the relevant repo context.
3. **The agent walks trust boundaries to sinks** and produces attack-path-grounded findings.
4. **Aggregate** into a security-focused report. Findings must include:
   - Attack path (end-to-end, in plain language).
   - Preconditions (what the attacker needs).
   - Mitigation (concrete code/config change).
   - Defense-in-depth (a second layer if the primary fails).
5. **Write** to `SECURITY-REVIEW.md` (or `SECURITY-REVIEW-<slug>.md`).
6. **Summarize back** with:
   - **Verdict** (`approve` / `request-changes` / `reject`).
   - Count of Blockers / Majors / Minors.
   - Top 3 findings with their attack paths.

## When to invoke

Always when the change touches: authentication, authorization, cryptography, secrets, input validation
at trust boundaries, deserialization, file uploads, template rendering, outbound HTTP triggered by user
input, or third-party SDK calls with user-controlled arguments.

## Guardrails

- **Concrete attack paths only.** "X could be vulnerable to injection" is not a finding. "An unauthenticated
  user can POST `{...}` to `/api/...`, which reaches sink `S` because of code path `P`" is.
- **Verify against the codebase.** Don't recite CVEs without tracing them in this code.
- **Don't bury Blockers in a list of Nits.** RCEs go at the top.
