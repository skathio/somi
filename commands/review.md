---
description: Strict, skeptical review of the current changes — or a plan, ADR, PR, or arbitrary diff. Severity-graded findings, evidence-driven, will reject weak solutions. Output lands under .somi/reviews/<slug>/.
argument-hint: <slug> | <diff range> | <PR #> | <file path> | "plan <slug>"
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit, WebFetch
model: sonnet
---

# /review — Reviewing workflow

You are running the **reviewing workflow** of somi-ai.

The user's review target: **$ARGUMENTS** (empty = the current working-tree diff vs. the default
branch, scoped to the single in-progress work item if exactly one exists).

> **Note:** plan-level review is part of this command. Use `plan <slug>` (or pass an `.somi/plans/`
> path) to review a spec/decisions/phases set instead of a diff. There is no separate
> `/plan-review` command anymore.

## What to do

### 1. Resolve the target

- **A work-item slug** (e.g. `rate-limiting-webhooks`) → review the latest iteration's diff against
  the spec/phases for that work item.
- **Empty / "working tree"** → `git diff` and `git status`. If exactly one work item has
  `status: in-progress` in `.somi/plans/`, scope the review to it.
- **A revision range** (e.g. `main..feature-x`) → use that range.
- **A PR number** (e.g. `#1234`) → fetch via `gh pr view --json` / `gh pr diff`; otherwise ask
  the user for the diff.
- **`plan <slug>`** → review the spec/decisions/phases for that work item, not its code. If
  exactly one work item has `status: awaiting-approval` or `planning` in `.somi/plans/` and the
  user typed bare `plan`, use it.
- **A file path** → review the file (typically an ADR or design doc outside `.somi/`).

### 2. Read for intent first

Find the relevant work item's `spec.md`, the iteration's `phases/<NN>-*.md`, recent diary entries,
and commit messages. If you can't tell what the change is for, that's finding #1.

For **plan reviews**, read the plan in full — don't skim. The point of plan review is to catch
errors that are cheaper to fix here than after code is written.

### 3. Brief the `reviewer` agent

Via the Task tool, pass:

- The target (diff, file, or plan-artifact set).
- The work-item paths (`spec.md`, the iteration phase file, recent `diary.md` entries,
  `context.md`) so the reviewer can check for scope drift and plan-vs-code divergence.
- An explicit framing: code review **or** plan review (severity calibration differs — see §4).
- An instruction to **return** (not write) the full review body and any proposed diary entry;
  the command owns all writes.

The `reviewer` agent is read-only (Read/Grep/Glob/Bash). If the target crosses the triggers
below, **also invoke** the relevant consultant via a separate Task call and merge its findings
into the review under a dedicated section:

| Trigger | Consultant agent | When |
|---|---|---|
| Auth / crypto / input validation / file upload / deserialization / template rendering / SSRF surface | `security-reviewer` | Both code and plan |
| New module / service / public contract / dependency-direction change / public interface | `architecture-reviewer` | Both code and plan |
| Mock-heavy diff, new flaky tests, e2e-only coverage of risky code, untestable seams | `test-strategist` | Code review |

Skipping a triggered consultant is itself a **finding** in the meta-review.

### 4. Aggregate findings

A single severity-graded report (Blocker / Major / Minor / Nit, each with High / Medium / Low
confidence). Use [`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl). When consultants
contributed, attribute findings (`[security] [Blocker / High] …`, `[arch] [Major / Medium] …`).

**Severity calibration — code review:**
- **Blocker** — correctness/security defect, broken contract, design lock-in.
- **Major** — significant maintainability or risk concern; requires explicit sign-off to merge.
- **Minor** — localized smell, can be follow-up.
- **Nit** — style/taste, no obligation.

**Severity calibration — plan review (be more skeptical here; plans are cheaper to fix):**
- **Blocker** — plan as written will produce a wrong or unsafe outcome.
- **Major** — plan will produce excessive rework, missed risk, or design lock-in.
- **Minor** — section is weak but plan is roughly right.
- **Nit** — taste/preference, no rework.

### 5. Write the review under `.somi/reviews/<slug>/`

Filename patterns:

- Code review: `<YYYY-MM-DD>-<phase>.<iter>-<verdict>.md` (e.g.,
  `2026-05-21-iteration-1-2-request-changes.md`).
- Plan review: `<YYYY-MM-DD>-plan-review-<verdict>.md`.
- Ad-hoc (no work item): `.somi/reviews/_ad-hoc/<YYYY-MM-DD>-<slug>.md`.

### 6. Update work-item state (if scoped)

The command (not the agent) writes these:

- In `progress.md`: append a line under "Recent activity" referencing the review file and verdict.
- If the reviewer returned a proposed `review-feedback` diary entry (because a Blocker/Major
  points at the plan rather than the code, or a plan-review finding requires plan changes),
  append it to `.somi/plans/<slug>/diary.md`. The follow-up `/code` (or next `/plan` revision)
  will then apply changes via the plan-change protocol.

### 7. Summarise back

- **Verdict** (`approve` / `approve-with-comments` / `request-changes` / `reject`).
- **Counts** by severity (attribute consultant findings separately if any).
- **Top 3 findings**, one line each, with severity.
- Pointer to the full review file under `.somi/reviews/<slug>/`.
- Next step:
  - `approve` / `approve-with-comments`: proceed to next iteration (`/code <slug>`) or merge.
  - `request-changes`: `/code <slug>` will pick up the findings (for code) or user revises
    the plan (for plan review).
  - `reject`: discuss with the user — usually means re-plan, not re-code.

## What to look for in a plan (when target is `plan <slug>`)

- **Restatement mismatch** — does `spec.md` §1 match the user's actual problem?
- **Missing non-goals** — vague non-goals breed scope creep.
- **Unstated assumptions** — beliefs the plan depends on that aren't called out in `context.md`.
- **Decision quality** — are entries in `decisions.md` real choices (with rejected alternatives
  carrying reasons), or did the agent pick without thinking?
- **Phase shapes** — coherent, reviewable, reversible? Or pseudo-phases ("implement / test /
  deploy")?
- **Iteration sizes** — is each ~1 PR? If not, split.
- **Risk realism** — specific failure modes with specific mitigations, or generic platitudes?
- **Security blind spots** — does `spec.md` §8 acknowledge auth/crypto/PII surfaces? Does it
  gate `security-reviewer` invocation in the right phase?
- **Test strategy** — risk-driven or coverage-worship?
- **Rollout & rollback** — flag plan, deployment, rollback steps?
- **Definition of Done** — measurable, not vibes-based?
- **Verification gaps** — decisions in `decisions.md` that should have been verified with the
  user but weren't.

## Guardrails

- **Do not rubber-stamp.** If the target is genuinely clean, say so with evidence (you read X,
  you traced Y).
- **Cite locations** with `path/to/file.ext:line-range` for every finding.
- **Grade honestly.** A long list of Nits is worse than one well-stated Blocker.
- **Reject when warranted.** Some changes shouldn't merge in any form — the right output is
  "reject" with the reason.
- **Plan-vs-code divergence is a finding**, even if the divergent code is technically fine.
- **Be more skeptical during plan review.** A plan with a beautifully filled-in template but no
  real choices is **worse** than a plan with blunt decisions and visible tradeoffs.

## Quality bar

See [`agents/reviewer.md`](../agents/reviewer.md). Findings must include where, what,
why-it-matters, and a concrete suggested fix. Vague platitudes are not findings.
