---
description: Bounded code → review → fix loop on a single iteration. Exits on approve, on Blocker/Major-free verdict, on iteration cap, on diff cap, or on a recurring finding (coder/reviewer disagree → human).
argument-hint: <slug> [phase N, iteration M]
allowed-tools: Task, Read, Edit, Write, Bash, Grep, Glob, WebFetch
model: sonnet
---

# /code-loop — Bounded code↔review iteration

You are running the **bounded code↔review loop** of somi.

The user's target: **$ARGUMENTS** (a work-item slug, optionally with `phase N, iteration M`).

This command automates the manual `/code` → `/review` → `/code` cycle for a single iteration,
with **hard gates** that ensure it terminates. This is an **ECO-tier** loop: the orchestrator and
the `coder` it Tasks both run `sonnet` (executing against the work item's `brief.md` + plan), while
the `reviewer` it Tasks stays `opus` — review is the fresh-eyes MAX judgment, run on a cold context
so it isn't biased by the coder's reasoning.

> **Cache-prefix discipline.** Keep the stable inputs — `rules/CLAUDE.md`, the work-item `brief.md`,
> `spec.md`, and the active `phases/<NN>-*.md` — in the **same order at the front** of each pass's
> coder brief, and append the volatile per-pass content (prior findings) **last**. A byte-stable
> prefix lets the 5-minute prompt cache hit across passes, a direct token saving in a multi-pass loop.

## Gates (hard, configurable via env)

| Gate | Default | Env override |
|---|---|---|
| `MAX_PASSES` — code→review cycles per iteration | `3` | `SOMI_CODE_LOOP_MAX_PASSES` |
| `SEVERITY_FLOOR` — verdicts that re-loop | `Major` (Blocker + Major) | `SOMI_CODE_LOOP_SEVERITY_FLOOR` (`Blocker` to only re-loop on Blockers) |
| `DIFF_CAP_LINES` — cumulative diff across passes | `400` | `SOMI_CODE_LOOP_DIFF_CAP` |
| `CIRCUIT_BREAKER` — stop if the same finding (file + symbol + title) recurs in 2 consecutive passes | always on | (n/a) |
| `REVIEW_MODE` — `single` (Task `reviewer`) or `panel` (Task [`/review-panel`](./review-panel.md), parallel multi-lens) | `single` | `SOMI_CODE_LOOP_REVIEW` (`panel`) |
| `HUMAN_CHECKPOINT` — pause between passes if user reply `stop` is detected | always on | (n/a) |

**Precedence:** env var (session override) > `.somi/config.json` (committed project policy —
keys `code_loop.max_passes`, `code_loop.severity_floor`, `code_loop.diff_cap_lines`,
`code_loop.review_mode`) > the defaults above. Read both at the start of the run; record the
effective values in the first diary entry of the loop.

## What to do

### 1. Resolve work item + iteration

Same logic as [`/code`](./code.md) §1–§2. If the iteration is missing or already `done`, stop and
ask the user.

### 2. Initialize loop state (deterministic, resumable)

The loop's arithmetic — pass counting, the diff baseline, cap checks, finding recurrence — is
owned by two shipped scripts, **not** by you simulating a state machine in context:
[`scripts/somi-loop.mjs`](../scripts/somi-loop.mjs) (state + caps) and
[`scripts/somi-findings.mjs`](../scripts/somi-findings.mjs) (the findings ledger). State survives
session death at `.somi/somi-state/loop/<slug>.<N>.<M>.json`.

- **Resume check first:** `node scripts/somi-loop.mjs resume --slug <slug> --iteration <N>.<M>`
  (path relative to the SoMi install root). If it prints a `running` state, a previous session
  died mid-loop — **continue from its recorded pass and baseline** instead of starting over, and
  tell the user you resumed.
- Otherwise initialize:

  ```bash
  node scripts/somi-loop.mjs init --slug <slug> --loop code --iteration <N>.<M> \
    --files "<the iteration's 'Files (approx)' paths, space-separated>"
  ```

  This captures `BASELINE_SHA = HEAD` **once** (never recomputed between passes; the cumulative
  diff is measured against it *including the working tree*, with `.somi/` and `.claude/`
  excluded so artifact churn doesn't eat the code budget), resolves the caps
  (flag > env > `.somi/config.json` > defaults), and prints the effective values.
- Set `RUN_ID` = the `started` timestamp from the state; pass it to every findings-ledger call
  in this loop.
- Append a diary entry (category `note`): title `code-loop started for phase <N>.<M>`, body =
  effective gate values + the iteration file list (+ "resumed from pass P" if resuming).

> **Host fallback.** If the host can't run shell scripts, track the same state manually as
> before (baseline SHA, pass counter, cumulative `git diff --shortstat`, finding recurrence by
> file + symbol + title) — identical gates, judgment-enforced — and say so in the summary.

### 3. Loop

```text
while true:
  # 3a. Pass gate (deterministic)
  node scripts/somi-loop.mjs pass --slug <slug> --iteration <N>.<M>
    exit 2 → STOP — write remaining ≥Major findings as progress.md follow-ups (by F-id),
             summarise, exit "max-passes-exceeded"

  # 3b. Code
  Task coder ( = /code <slug> phase <N>, iteration <M>, brief = current_findings or initial spec )

  # 3c. Diff & scope gate (deterministic — cumulative vs the recorded baseline, working tree
  #     included, .somi/.claude excluded; out-of-scope lines count DOUBLE)
  node scripts/somi-loop.mjs check-diff --slug <slug> --iteration <N>.<M>
    exit 3 → STOP — exit "diff-cap-exceeded"; if the printed JSON's out_of_scope is non-empty,
             report the stop as "scope-expansion" and name the files

  # 3d. Review — single reviewer, or the parallel panel when REVIEW_MODE == panel
  if REVIEW_MODE == "panel":
    Task /review-panel ( = <slug> phase <N>, iteration <M> )   # parallel multi-lens, merged verdict
  else:
    Task reviewer ( = /review <slug>, scope = this iteration's diff )

  # 3e. Record the pass + findings. The ledger computes recurrence on a STABLE locus
  #     (file + symbol + normalized title — never the raw line number, which drifts between
  #     passes and would let coder and reviewer oscillate to the pass cap unnoticed).
  node scripts/somi-loop.mjs record-pass --slug <slug> --iteration <N>.<M> \
    --verdict <V> --blockers <B> --majors <MJ>
  echo '<review findings as a JSON array [{file, symbol, title, severity, confidence}, …]>' \
    | node scripts/somi-findings.mjs record --slug <slug> --review <review-file> \
        --run $RUN_ID --pass <current pass>
    exit 5 → STOP — the same finding recurred in two consecutive passes: coder and reviewer
             disagree; hand to human (circuit breaker). Also surface any finding the output
             flags recurring_cross_run — that's /ship-loop's cross-layer breaker signal.

  # 3f. Verdict
  if verdict == "approve" or no finding at severity >= SEVERITY_FLOOR:
    somi-findings.mjs resolve each finding this pass fixed ( --status fixed --by <review-file> )
    DONE — proceed to §4

  # 3g. Next pass
  current_findings = subset of new findings at severity >= SEVERITY_FLOOR
  append diary line: pass#, verdict, Blocker/Major counts, cumulative diff size (from 3c)
```

### 4. On DONE (clean exit)

- `node scripts/somi-loop.mjs finish --slug <slug> --iteration <N>.<M> --status done`.
- Mark iteration `done` in `phases/<NN>-*.md`.
- Update `progress.md` (phase row, "Last activity").
- Append a diary entry (category `note`): `code-loop done at pass <P>; verdict <V>`.
- Summarise (see §6).

### 5. On STOP (gate hit)

- `node scripts/somi-loop.mjs finish --slug <slug> --iteration <N>.<M> --status stopped-<reason>`.
- Do **not** mark iteration `done`.
- Append a diary entry (category `blocker` or `plan-change`): which gate fired, what's
  outstanding, what the user needs to decide.
- Write remaining ≥Major findings as `progress.md` follow-ups **by ledger id** (`F-3: <title>`)
  so they aren't lost and the next review can assert their resolution.
- Summarise with explicit next step (usually: human review of the partial work, then a
  manual `/code` or `/plan` revision).

### 6. Summarise back

- Loop status: `done` | `max-passes-exceeded` | `diff-cap-exceeded` | `scope-expansion` |
  `circuit-breaker` | `user-stop`.
- Passes used (out of `MAX_PASSES`) — from `somi-loop.mjs stats` (also the run's telemetry:
  per-pass verdicts, Blocker/Major counts, diff sizes).
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
