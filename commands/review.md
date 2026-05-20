---
description: Strict, skeptical review of the current changes (or a specified diff/PR/plan). Severity-graded findings, evidence-driven, will reject weak solutions.
argument-hint: <optional: diff range, PR number, file path, or "plan">
allowed-tools: Task, Read, Grep, Glob, Bash, WebFetch
model: opus
---

# /review — Reviewing workflow

You are running the **reviewing workflow** of somi-ai.

The user's review target: **$ARGUMENTS** (empty = the current working-tree diff vs. the default branch).

## What to do

1. **Resolve the target.**
   - Empty / "working tree" → `git diff` and `git status`. Identify the changed files.
   - A revision range (e.g. `main..feature-x`) → use that.
   - A PR number (e.g. `#1234`) → fetch the diff via `gh pr view --json` / `gh pr diff` if available;
     otherwise ask the user for the diff.
   - "plan" or a `PLAN.md` path → review the plan, not code.
   - A file path → review the file (typically used for ADRs / design docs).
2. **Read for intent first.** Find the relevant `PLAN.md`, commit messages, or ticket. If you can't tell
   what the change is for, that's finding #1.
3. **Brief the `reviewer` agent** via the Task tool. Pass:
   - The target diff/file/plan.
   - The plan if one exists (so the reviewer can check for scope drift).
   - Hints about which agents should be additionally consulted, if any:
     - Touches auth/crypto/input → also consult `security-reviewer`.
     - Introduces new module/service/contract → also consult `architecture-reviewer`.
     - Test shape problems → also consult `test-strategist`.
4. **Aggregate findings** into a single severity-graded report
   (Blocker / Major / Minor / Nit, each with High / Medium / Low confidence).
5. **Write the review** to `REVIEW.md` (or `REVIEW-<short-slug>.md` if one exists) using
   [`templates/REVIEW.md.tmpl`](../templates/REVIEW.md.tmpl).
6. **Summarize back** with:
   - **Verdict** (`approve` / `approve-with-comments` / `request-changes` / `reject`).
   - **Counts** by severity.
   - **Top 3 findings** by severity, with one-line each.
   - Pointer to the full review file.

## Guardrails

- **Do not rubber-stamp.** If the diff is genuinely clean, say so with evidence (you read X, you traced Y).
- **Cite locations** with `path/to/file.ext:line-range` for every finding.
- **Grade honestly.** A long list of Nits is worse than one well-stated Blocker.
- **Reject when warranted.** Some changes shouldn't merge in any form — the right output is "reject" with
  the reason.

## Quality bar

See [`agents/reviewer.md`](../agents/reviewer.md). Findings must include where, what, why-it-matters, and
a concrete suggested fix. Vague platitudes are not findings.
