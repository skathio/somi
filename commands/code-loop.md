---
description: Bounded code → review → fix loop on a single iteration. Exits on approve, on Blocker/Major-free verdict, on iteration cap, on diff cap, or on a recurring finding (coder/reviewer disagree → human).
argument-hint: <slug> [phase N, iteration M]
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: sonnet
---

# /code-loop — Bounded code↔review iteration

You are running the **bounded code↔review loop** of somi-ai.

The user's target: **$ARGUMENTS** (a work-item slug, optionally with `phase N, iteration M`).

This command automates the manual `/code` → `/review` → `/code` cycle for a single iteration,
with **hard gates** that ensure it terminates. The orchestrator (this command) is `sonnet`;
the `coder` and `reviewer` agents it Tasks remain `opus`.

## Gates (hard, configurable via env)

| Gate | Default | Env override |
|---|---|---|
| `MAX_PASSES` — code→review cycles per iteration | `3` | `SOMI_CODE_LOOP_MAX_PASSES` |
| `SEVERITY_FLOOR` — verdicts that re-loop | `Major` (Blocker + Major) | `SOMI_CODE_LOOP_SEVERITY_FLOOR` (`Blocker` to only re-loop on Blockers) |
| `DIFF_CAP_LINES` — cumulative diff across passes | `400` | `SOMI_CODE_LOOP_DIFF_CAP` |
| `CIRCUIT_BREAKER` — stop if the same finding (file:line + title) recurs in 2 consecutive passes | always on | (n/a) |
| `HUMAN_CHECKPOINT` — pause between passes if user reply `stop` is detected | always on | (n/a) |

Read overrides from the environment at the start of the run; record the effective values in
the first diary entry of the loop.

## What to do

### 1. Resolve work item + iteration

Same logic as [`/code`](./code.md) §1–§2. If the iteration is missing or already `done`, stop and
ask the user.

### 2. Initialize loop state

- Set `pass = 1`.
- Compute `iteration_file_list` = the iteration's "Files (approx)" list. Diff outside this list
  during the loop is **scope expansion**; the diff cap shrinks proportionally.
- Initialize `previous_findings = []` (used by the circuit breaker).
- Append a diary entry (category `note`):
  - Title: `code-loop started for phase <N>.<M>`.
  - Body: effective gate values + the iteration file list.

### 3. Loop

```text
while pass <= MAX_PASSES:
  # 3a. Code
  Task coder ( = /code <slug> phase <N>, iteration <M>, brief = current_findings or initial spec )

  # 3b. Verify diff size & scope
  cumulative_diff_lines = git diff --shortstat <baseline>..HEAD | parse
  if cumulative_diff_lines > DIFF_CAP_LINES:
    STOP — write follow-ups to progress.md, summarise, exit "diff-cap-exceeded"
  if any file changed not in iteration_file_list:
    SHRINK DIFF_CAP — scope expansion counts double; if still over, STOP

  # 3c. Review
  Task reviewer ( = /review <slug>, scope = this iteration's diff )

  # 3d. Verdict
  if verdict == "approve" or no finding at severity >= SEVERITY_FLOOR:
    DONE — proceed to §4

  # 3e. Circuit breaker
  if any finding in current_findings matches a finding in previous_findings
      by (path:line, title):
    STOP — coder and reviewer disagree; hand to human

  # 3f. Next pass
  previous_findings = current_findings
  current_findings = subset of new findings at severity >= SEVERITY_FLOOR
  pass += 1
  append diary line: pass#, verdict, Blocker/Major counts, cumulative diff size

# Out of loop
if pass > MAX_PASSES:
  STOP — write remaining findings as progress.md follow-ups, summarise, exit "max-passes-exceeded"
```

### 4. On DONE (clean exit)

- Mark iteration `done` in `phases/<NN>-*.md`.
- Update `progress.md` (phase row, "Last activity").
- Append a diary entry (category `note`): `code-loop done at pass <P>; verdict <V>`.
- Summarise (see §6).

### 5. On STOP (gate hit)

- Do **not** mark iteration `done`.
- Append a diary entry (category `blocker` or `plan-change`): which gate fired, what's
  outstanding, what the user needs to decide.
- Write remaining ≥Major findings as `progress.md` follow-ups so they aren't lost.
- Summarise with explicit next step (usually: human review of the partial work, then a
  manual `/code` or `/plan` revision).

### 6. Summarise back

- Loop status: `done` | `max-passes-exceeded` | `diff-cap-exceeded` | `scope-expansion` |
  `circuit-breaker` | `user-stop`.
- Passes used (out of `MAX_PASSES`).
- Final verdict + count by severity.
- Cumulative diff size and any out-of-scope files touched.
- Pointer to all review files under `.somi/reviews/<slug>/` from this loop.
- Next step.

## Guardrails

- **Never silently bypass a gate.** If a gate is wrong for this work item, the user adjusts the
  env var explicitly and re-runs — the loop does not "decide" to widen its own bounds.
- **The user can reply `stop` between passes.** Honour it immediately, treat it as the
  `user-stop` exit.
- **Plan-change protocol still applies.** If the coder discovers a planning gap mid-pass, it
  pauses the loop, follows `/code` §5 (update spec/decisions/phases, diary entry), and the loop
  resumes on the revised plan (this counts as one pass).
- **One iteration per loop.** This command does *not* march through multiple iterations. Each
  iteration gets its own `/code-loop` invocation.
- **Reviewer is read-only.** The command (this orchestrator) owns all `progress.md` /
  `diary.md` writes — the agents return text, this command persists.

## Why this command exists

`/ship`'s Stage 2↔3 loop was unbounded — cosmetic findings could loop forever and scope could
creep across passes. `/code-loop` is the bounded extraction: the same shape, but with caps,
a severity floor, a diff cap, and a circuit breaker. `/ship-loop` (and `/ship`) now compose this
command rather than re-implementing an uncapped loop.
