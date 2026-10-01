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

## Gating vs report-only

Not every dimension above will block certification. A criterion is **gating** only if
(1) **bidirectional** — its executor can independently produce both `pass` and `fail` from the
artifact alone, no draw resting on a judge-authored `pass` — **and** (2) **sound** — that verdict
comes from complete enumeration over a closed input, not pattern search over open-ended content
(`decisions.md#d11`, applied without exception). **A dimension gates only if every criterion tagged
with it, within that task, is individually gating** — clause 1's own aggregation rule, stated once,
no carve-out. Everything else is classified **report-only** — to be measured and recorded on `reportOnly`, not gating.

The settled classification lives in `tests/evals/lib/classification.mjs`, not duplicated here —
tripling the same fact across `decisions.md`, that file, and this one is the exact drift this
section exists to prevent. `tests/scripts/eval-runner.sh` ties `classification.mjs` to
`decisions.md`'s own content directly; see that file's own header for what the check catches and
what it structurally cannot (`decisions.md` lives under `.somi/`, which is gitignored repo-wide, so
the comparison against its actual text only ever runs where the plan directory is present on disk).

**Settled (`decisions.md#d11`): 2 of 13 task-dimensions gate** — task 01's S3, task 02's S5. Task 03
contributes zero. As of iteration 2.4b, `certify()` honours this classification directly:
`buildResult()` splits every measured dimension into `dimensions` (gating only, built from
`classification.mjs`'s table) and `reportOnly` (everything else) per draw, and `certify()` reads
exclusively from `dimensions` — a report-only criterion is measured, recorded on `reportOnly`, and printed in `certify()`'s own summary alongside the gating rows, but can never gate a
certification. `compare()`'s own code is unaffected (it already takes whatever grade map it's
handed), but the same contract holds once phase 3/4 wire it to real corpus data: reading grades
from `dimensions` rather than `reportOnly` is what keeps a trim decision from gating on a criterion
that never earned it. `SCOPES.full` pools the 2 gating dimensions
(`covers: '2 of 13 task-dimensions'`), derived from a new `CERTIFY_N = 120` constant: **240 draws,
budget 5, clears a sound corpus 96.51% of the time and a soft one 1.81%** — re-derived, not scaled,
after `decisions.md#d11`'s 2026-08-28 resolution narrowed the gating count from 3 to 2 (the same
total draws as the 3-dimension figure, since the pooled false-accept rate depends only on total
draws, not on how many dimensions share them — `CERTIFY_N` rose from 80 to 120 to hold it). A
per-dimension floor (`decisions.md#d11`, Blocker F-46) additionally requires every gating dimension
to individually clear `CERTIFY_N`, present in `dimensions` or not — the pooled count alone cannot
tell a dimension that went fully soft from one that was never observed.

**This per-task classification is what `../../docs/EVALS.md`'s coverage table labels per command**
(`decisions.md#d8`'s floor rule, applied per task via the "Command under test" line each task spec
names): a command with fewer than half its tagged dimensions gating reads `partial`; zero gating
dimensions reads `report-only`, distinct from `partial` because it implies no gating capability at
all, not a smaller share of one. `/code-loop`'s convergence gate (D1–D5) is a different mechanism
entirely — a Mann-Whitney comparison, not a criterion count — and is unaffected by this floor. The
command-level table is not repeated here: two documents both stating the same derived numbers is
the exact drift this section's own history (D7 → D11, three narrowing passes) exists to warn
against; `tests/scripts/eval-runner.sh` derives both from `classification.mjs`/`SCOPES` directly
and cross-checks `../../docs/EVALS.md`'s table against that live derivation.

**`grade()`'s band and `certify()`'s budget diverge further at `CERTIFY_N`, and that is expected,
not a contradiction.** `grade()` scales its ≥18/20 pass band proportionally to whatever `n` it is
given; at `CERTIFY_N = 120` that scaled boundary is 108/120 — a dimension right at that line
individually reads `pass`, yet contributes 12 failures against `SCOPES.full`'s whole budget of 5
(at `BANDS.n = 20` the same boundary contributes only 2). So a printed `S3: pass` sitting next to
`certified: false` is `grade()`'s routine per-dimension threshold and `certify()`'s pooled
corpus-quality bar answering two different questions, not one contradicting the other.

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

**Operating characteristics** (binomial, computed not asserted): false reject **0.201%** — but only under the `dimensions`-only reading this section commits `compare()` to, which `phases/03-convergence-gating.md`'s risk pointer records as UNSETTLED (the live alternative feeds `compare()` the full `dimensions ∪ reportOnly` map, under which this figure reverts to the 13-dimension **1.3%**).
False accept on a 15-point regression **20.6%**, on a 25-point regression **3.5%** — both per-dimension figures are literally unaffected by the count, but the count's own effect is that under the `dimensions`-only reading the other eleven task-dimensions' regressions are not merely under-detected but invisible to the trim rule entirely.

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

## The convergence gate's own pass/fail

Everything above scores `/plan`, `/code`, and `/review` against fixed task criteria. `/code-loop`'s
own gate (phase 3) is a different mechanism entirely — a **Mann-Whitney comparison** of two arms'
passes-to-approve, not a criterion count — so it gets its own pass/fail semantics here rather than
being forced into the task-dimension shape above.

A cap-breach (`max-passes-exceeded`, `diff-cap-exceeded`, `scope-expansion`, `circuit-breaker`,
`user-stop`) fails the comparison outright, independent of the statistical result. Short of a
breach, the comparison reports exactly one of three states — never a bare pass/fail, and `p ≥ α`
alone is never read as `no-regression`:

| verdict | condition |
|---|---|
| `regression` | `p < α` |
| `no-regression` | `p ≥ α` **and** the observed effect's upper confidence bound excludes the gate's sized shift (equivalence, not merely "not significant") |
| `inconclusive` | everything else — reported and blocks, exactly like `cannotCertify` blocks the task corpus above |

**N=15 draws per arm** is not a round number — it is the smallest N at which an `inconclusive`
result reads as inconclusive rather than as a silently accepted pass, derived from a stated power
target. Full derivation: `decisions.md#d2`.

**The comparison itself is a tie-conditional permutation test (Monte Carlo), one-sided, α=0.05** —
not the untied exact recursion, which assumes distinct values and is measurably wrong on data this
heavily tied (convergence draws are small positive integers with heavy repeats). Full derivation
and the rejected alternatives: `decisions.md#d5`.

See `../../docs/EVALS.md`'s "The convergence gate" for how to run it.

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
