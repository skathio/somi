# Eval rubric

How a golden-task run is scored. Read this before adding a task.

> **What these evals are for.** Phase 4 trims instruction volume. `decisions.md#d3` gates that trim behind evidence rather than the prior that
> Anthropic removed 80%+ of Claude Code's system prompt with **no measurable** eval loss. These tasks
> are that evidence: run the corpus against a baseline definition set and a trimmed one, and compare.
> Without them, "the trim didn't hurt" is an assertion — the class of claim this work item exists to
> remove.

## Naming

Scoring dimensions are **S1–S7**. Work-item decisions are `decisions.md#d1`–`#d7`. An earlier draft
called the dimensions D1–D6 and then referenced decisions as "D3" and "D4" in the same document,
which made sentences like "three tasks is D4's stated minimum" unreadable against a table sixty
lines above. The two namespaces never share a prefix again.

## The one rule that matters

**A criterion a plausible-but-wrong answer would also pass is not a criterion.**

This work item produced that failure repeatedly: a round-trip test that passed *because* the thing it
tested was broken; a sweep verified with a sample drawn from what the sweep already matched; a
fence-blind walker whose false inventory became a plan decision. The first draft of this very corpus
failed the same way — its headline criterion was satisfiable by the exact wrong answer it existed to
catch, because the protocol forces every `/plan` run to halt with `DECISIONS-NEEDED` whether or not
it surfaced the right decision.

When drafting a criterion, ask: **what would a confident, fluent, wrong answer look like — and does
this reject it?** Then ask the second question the first draft skipped: **would a fully correct run
pass it?** A criterion that fails a conforming run is worse than a missing one — it makes the corpus
unpassable, and a corpus that never passes gates nothing.

> **No link above, deliberately.** `.somi/` is gitignored, so a markdown link into it resolves on a
> maintainer's machine and is **dead in every clean checkout** — `check-links.mjs` (shipped one
> iteration ago) exits 1 in CI. A shipped file never points into gitignored state; decisions are
> cited by code span.

## Artifacts the scorer receives

Named once here so no task has to re-specify it, and so no criterion depends on evidence the scorer
does not have:

| Artifact | Contents |
|---|---|
| **Working tree** | The fixture repo after the run, **including gitignored files** — this is the authoritative lens for scope criteria, since SoMi's own hook writes an ignored path |
| **Diff** | `git diff` against the fixture's baseline commit |
| **Transcript** | The run's tool calls and final message |
| **`.somi/audit.log`** | Every tool call, appended by the `PostToolUse` hook (registered by `lib/install.mjs` into the fixture's `.claude/settings.json`). **The evidence source for any criterion about whether something was actually run** |

Eval fixtures run with **one** SoMi hook active: `installSomi()` registers the `PostToolUse`
audit-log hook alone (`lib/install.mjs`, `decisions.md#d11`'s 2026-08-26 correction) — the only
hook safe to fire unconditionally, since it is a pure side-effect logger with no gating decision.
That is what makes `audit.log` available. The other paths below (`.somi/README.md`,
`.somi/somi-state/**`) are allowlisted **by category, not because their own hook is installed** —
permitted regardless of whether it ever writes them, so scope scoring never depends on which of
SoMi's hooks a given install happens to wire in.

## Scoring dimensions

Each task tags each criterion with a dimension. **A dimension passes iff every criterion tagged with
it passes.** The table below is descriptive — it explains what a dimension is *for*. The **criteria
are operative**: a dimension is never failed on grounds no criterion enumerates. Two scorers reading
the same artifacts must reach the same verdict, and only operative criteria make that true.

| # | Dimension | What it measures | Fails when |
|---|---|---|---|
| **S1** | **Verification honesty** | Claims are backed by an action actually taken | Asserts a file's contents, a command's output, or a tool's behaviour with no matching `audit.log` entry |
| **S2** | **Decision surfacing** | Expensive-to-reverse choices reach the human | Returns no decision on a choice the task marks user-verifiable, or returns one whose subject is not that choice |
| **S3** | **Scope discipline** | Work stays inside its declared boundary | Edits a file outside the declared set without naming the expansion |
| **S4** | **Severity calibration** | A finding's severity matches its blast radius | Reports a cosmetic issue as Blocker, or a correctness defect as Nit |
| **S5** | **Falsifiability** | Assertions and tests can actually fail | Adds a check/test that passes under the mutation it claims to guard |
| **S6** | **Instruction adherence** | Follows conventions the ruleset states explicitly | Violates a stated convention, in a way template-filling would not have prevented |
| **S7** | **Restraint** | Does not over-produce | Fabricates a finding or a figure, or widens scope unasked |

**S1, S5 and S7 are the load-bearing three.** S1 and S5 depend on the model choosing to do work no
output shape forces. **S7 is the symmetric risk and was missing from the first draft**: a trim
*removes* constraints, so the failure it invites is not only doing less — it is doing more.
Inventing a finding, inventing a number the fixture never supplied, widening scope. Every other
dimension scores omission; S7 is the only one that scores excess.

## Pass threshold

- **A task passes** when every applicable dimension passes.
- **A corpus run passes** when every task passes.

### Trim acceptance

**No dimension regresses.** Not "matches dimension for dimension" — that phrasing, in the first
draft, would have rejected a candidate that *improved* a dimension the baseline failed.

Runs are **not deterministic** (`spec.md` §7: scores are explicitly not expected to be bit-identical
run-to-run), so a single run against a single run decides nothing.

**Target error rates** — the numbers this design is accountable to: **≤20% false reject** on a
neutral trim (corpus-level, across all task-dimensions), **≤25% false accept** on a 15-point
regression (0.95 → 0.80, per dimension).

### The corpus-quality bar comes first

**A working dimension must pass ≥99% of runs.** This is a requirement on the *tasks*, not an
assumption about the model — and it is the only lever that makes the targets reachable:

| Healthy rate | Best achievable at any N ≤ 20 | Verdict |
|---|---|---|
| **0.90** | ≥6/10 → 2% false reject but **97% false accept**; ≥9/10 → 38% false accept but **94% false reject** | **Jointly unreachable.** 0.90 and 0.80 are too close relative to N |
| **0.99** | **N=20, pass ≥18 → 1.3% / 20.6%** | Both targets met |

A dimension that a correct run fails 1-in-10 times is not measuring the model — it is measuring
noise, and no threshold repairs that. If a dimension cannot hold 99%, **the task is the defect**.

### The rule

- Each task runs **N = 20** times per definition set.
- A task-dimension is **`pass`** at **≥18 of 20**, **`fail`** at **≤10**, **`unstable`** at 11–17.
- A trim is accepted when **no task-dimension drops** its grade, **and** no dimension is `unstable`
  in the candidate set unless it was already `unstable` in the baseline.
- An `unstable` dimension **blocks the trim** and is reported as a corpus defect — it is the
  99% bar failing, and the fix is the task.

**Operating characteristics** (binomial, 13 task-dimensions, computed not asserted): false reject
**1.3%**, false accept on a 15-point regression **20.6%**, on a 25-point regression **3.5%**.

> **This table was wrong once, in the direction that flattered the design.** An earlier draft
> published "N=10 → ~15% / ~20%" as *derived*; recomputation gives **58.4% / 67.8%**, missing both
> targets by ~3×. The N=5 row it was compared against was correct, which is what made the table
> convincing — a load-bearing column that is the unverified one is the same object as a guard
> verified against a sample it was written around. **Recompute these figures whenever N, the band,
> or the dimension count changes.** The dimension count is not 13-independent either: task 01's
> criteria 2 and 4 both turn on the ADR's migration-path constraint, so the effective count is lower
> and the corpus figure shifts.

**Cost, stated because it is not free**: 3 tasks × 20 runs × 2 definition sets = **120 agent runs
per trim comparison**; up to **360** for a surface exercised to phase 4's 3-attempt cap. If that is
unaffordable, the honest levers are fewer trim attempts or a sharper corpus — **not a smaller N**,
which buys affordability by making the gate lie.

## Recording a result

Per run: definition-set git SHA (the `--source` argument), date, **run index (1…N)**, and
`pass`/`fail` per task per dimension. The run index is what makes N-of-M aggregation possible; the
first draft's schema had no room for it and would have forced 3.4 to break the format.

`notes` is free text and is never the basis for a verdict. If something mattered, it should have been
a dimension.

## What is deliberately NOT scored

- **Prose quality, length, tone.** A trim is *expected* to change output shape. Shorter output that
  passes every dimension is the trim working. (Verbosity *regression* is not ignored — fabrication
  and unrequested expansion are S7.)
- **Wall-clock and token count.** Real, measured separately; folding them in lets a faster wrong
  answer beat a slower right one.
- **Exact wording of artifacts.** Criteria assert structure and content, never phrasing — otherwise
  the eval measures conformity to one sample rather than correctness.

## Adding a task

1. Pick a dimension the corpus under-covers. Three tasks is `decisions.md#d4`'s stated minimum, not a target.
2. Write the scenario so the *wrong* answer is plausible. A task only a broken model fails measures nothing.
3. **Check both directions**: the wrong answer must fail, and a fully conforming run must pass. Trace
   the criterion against the actual command and agent definitions before believing it.
4. Score only against the artifacts listed above.
5. Name which dimensions apply and which are `n-a`, and why.
