---
description: Design or critique a test strategy for a change. Risk-driven coverage, level selection (unit/integration/e2e), mock policy, determinism. Output lands under .somi/reviews/<slug>/ when scoped.
argument-hint: <slug> | <file path> | <free-form description of what to test>
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit, WebFetch
model: sonnet
---

# /test-strategy — Targeted test-strategy review

You are running a **test-strategy-only** review using somi-ai.

Target: **$ARGUMENTS** (empty = scoped to the single in-progress work item if exactly one exists).

## When to invoke

- Planning the test strategy for a new feature or work item.
- Existing tests feel wrong: too many mocks, slow, flaky, brittle, low-signal.
- Adding tests to legacy code with poor seams.
- Choosing between unit / integration / e2e for a particular concern.
- Deciding whether something is worth testing at all.

## What to do

### 1. Resolve the target

- **A work-item slug** → read `spec.md` §7, the relevant phase files, and the existing tests in
  the affected modules.
- **A file path** → review tests adjacent to (and exercising) that file.
- **A free-form description** → ask the user to point at the code if not obvious.

### 2. Brief the `test-strategist` agent

Via the Task tool, pass:

- The work-item or code paths.
- A description of what's being tested and what the risks are (if known).
- The expectation: identify risks, identify testable surface, pick the right level per concern,
  decide mock policy, design for diagnosis, define what's intentionally **not** covered.

The `test-strategist` agent is read-only (Read/Grep/Glob/Bash). Have it **return** its strategy;
the command owns all writes.

### 3. Output shape

A strategy document with:

- **Risks targeted** — bulleted list of failure modes that matter for this code.
- **Coverage decisions** — which risks land at unit / integration / e2e, and why.
- **Test inventory** — per level, the specific tests to add/change and what each proves.
- **Mock policy** — what's faked, what's real, what's mocked (with justification).
- **Determinism plan** — how time, randomness, ordering are controlled.
- **Intentionally not covered** — what was skipped and why it's an acceptable risk.
- **Diagnostic quality** — how a failure points to the cause.

### 4. Write the review (when scoped)

Filename pattern: `<YYYY-MM-DD>-test-strategy-<phase>.<iter>.md` under `.somi/reviews/<slug>/`
when scoped to a work item; otherwise `.somi/reviews/_ad-hoc/<YYYY-MM-DD>-test-strategy-<slug>.md`.

For work-items, also propose an update to `spec.md` §7 if the existing strategy is wrong-shaped.
The command applies the update (the agent only proposes).

### 5. Update work-item state (if scoped)

- `progress.md`: append a line under "Recent activity" referencing the strategy doc.
- If the strategy requires plan changes (e.g., a phase is added to introduce characterization
  tests before refactoring), append a `review-feedback` diary entry — the next `/plan` revision
  or `/code` invocation applies the change.

### 6. Summarise back

- Top 3 risks the strategy targets, with chosen level.
- Mock decisions taken (especially anything you opted to *not* mock).
- Pointer to the strategy file.
- Next step (usually `/code <slug>` to implement the tests).

## Guardrails

- **Coverage worship is rejected.** 100% line coverage of trivial paths is not safety.
- **Don't mock what you don't own.** Prefer fakes you author against a real contract.
- **Flake potential is a bug**, not a quirk. A `--retry 3` flag is a tombstone for code quality.
- **State non-coverage explicitly.** Skipping coverage without saying why is hiding risk.
