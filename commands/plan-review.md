---
description: Review a plan (PLAN.md or an ADR) before coding starts. Catches scoping errors, missing risks, unstated assumptions, and bad architectural choices early.
argument-hint: <optional: path to plan or ADR; defaults to PLAN.md>
allowed-tools: Task, Read, Grep, Glob
model: opus
---

# /plan-review — Review a plan before coding

You are running a **plan-level review** of somi-ai.

The target plan: **$ARGUMENTS** (defaults to `PLAN.md`).

## What to do

1. **Resolve the target.** Default `PLAN.md` at the repo root. If `$ARGUMENTS` points elsewhere, use that.
   If the file doesn't exist, ask the user.
2. **Read the plan in full** — don't skim. The point of plan review is to catch errors that are cheaper
   to fix here than after code is written.
3. **Brief the `reviewer` agent** ([`agents/reviewer.md`](../agents/reviewer.md)) with the plan and any
   relevant repo context, asking explicitly for a **plan-level review**.
4. **Additionally invoke `architecture-reviewer`** if the plan introduces a new module/service/contract
   or changes dependency direction.
5. **Aggregate findings** focused on the plan's specific failure modes (see below).

## What to look for in a plan

- **Restatement mismatch** — does the plan's framing match the user's actual problem?
- **Missing non-goals** — what's explicitly *not* being done? Vague non-goals breed scope creep.
- **Unstated assumptions** — beliefs the plan depends on that aren't called out.
- **Phase shapes** — are phases coherent, reviewable, and reversible? Or are they "implement / test /
  deploy" pseudo-phases?
- **Iteration sizes** — is each iteration ~1 PR? If not, the iteration needs splitting.
- **Risk realism** — are risks specific failure modes with specific mitigations, or generic platitudes?
- **Security blind spots** — does the plan acknowledge auth/crypto/PII surfaces? Does it gate
  `security-reviewer` invocation in the right iteration?
- **Test strategy** — is it risk-driven, or coverage-worship?
- **Rollout & rollback** — flag plan, deployment, rollback steps?
- **Definition of Done** — measurable, not vibes-based?
- **Open questions** — does the plan acknowledge what the human still needs to decide?

## Output

Write to `PLAN-REVIEW.md` using a similar structure to
[`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl) but with **plan-level severity grading**:

- **Blocker** — plan as written will produce a wrong or unsafe outcome.
- **Major** — plan will produce excessive rework, missed risk, or design lock-in.
- **Minor** — plan is roughly right but a section is weak.
- **Nit** — taste/preference, no rework needed.

Summarize back with the verdict, severity counts, and the top 3 findings.

## Guardrails

- Plans are cheaper to fix than code. Be **more skeptical** during plan review than code review — push
  back on weak choices.
- **Reject** when the plan needs to be re-thought, don't just request changes.
