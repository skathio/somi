# Behavioral evals

SoMi's structural checks (`npm test`) prove that files exist, links resolve, and copies agree.
They cannot tell you whether a definition set makes an agent *behave* better. This corpus can.

It exists for one job: **phase 4 trims SoMi's instruction surface, and something has to say
whether the trim broke anything.** Every design decision below follows from that.

## The invariant

> **`npm test` never invokes a model, never reaches the network, and never reads a credential.**

This is not a convenience. A test suite that silently needs an API key stops running in CI, and a
suite that stops running is worse than one that never existed — it reports green by not executing.
The corpus is therefore behind its own entrypoint:

```sh
npm test              # structural. hermetic. always runs.
npm run eval:behavioral   # invokes a model. needs network + a credential. never in CI's default path.
```

`tests/scripts/evals-packaging.sh` enforces the separation at the **invocation** level, not by
grepping for mentions — `validate.sh` must name `tests/evals/` to syntax-check it, so a "no
mention" rule would be self-contradicting. What is forbidden is *executing* the runner from
anything `npm test` reaches.

## What is measured

Seven dimensions, defined in [`../tests/evals/rubric.md`](../tests/evals/rubric.md). Each task
tags each criterion with a dimension, and **a dimension passes iff every criterion tagged with it
passes**. The unit of measurement is a *task-dimension* — task 01's S2, task 03's S5.

| | | |
|---|---|---|
| **S1** | Grounding | Claims are checkable and check out |
| **S2** | Decision surfacing | The expensive-to-reverse choice reaches the human |
| **S3** | Boundary respect | The declared file set is the file set |
| **S4** | Severity calibration | Findings are ranked by blast radius |
| **S5** | Falsifiability | Assertions and tests can actually fail |
| **S6** | Reasoning transparency | The tradeoff is stated, not implied |
| **S7** | Over-production | Nothing is invented that the input did not supply |

## Run counts and thresholds

Each task runs **N = 20** times per definition set. A task-dimension is **`pass`** at ≥18/20,
**`fail`** at ≤10, **`unstable`** between.

These are not free parameters. They come from a binomial power analysis against a stated bar —
**a working dimension must pass ≥99% of runs** — and that bar is a requirement on the *tasks*, not
a hope about the model. A dimension a correct run fails 1-in-10 times is not measuring the
definition set; it is measuring noise. At a 0.90 healthy rate the targets are jointly unreachable
at any N, which is why the bar is where it is.

An earlier draft encoded N=10 bands. The arithmetic behind them was wrong by ~3×, in the direction
that flattered the design. Both figures were recomputed and the corpus was rebuilt around the
corrected ones — see `rubric.md` for the table.

Cost: **120 agent runs per trim comparison**, up to 360 for a surface at phase 4's three-attempt cap.

## Accepting a trim

A trim is accepted when **no task-dimension drops its grade**, and **no dimension is `unstable` in
the candidate set unless it was already `unstable` in the baseline**.

The second clause is easy to miss and `compare()` in [`../tests/evals/run.mjs`](../tests/evals/run.mjs)
tests for it separately: `fail → unstable` ranks as an *improvement* by grade order, so an ordering
check alone cannot see it. That branch survived every other unit test until a mutation run found it.

## The corpus is scorer-side

Nothing under `tests/evals/` ships to npm — verified by `npm pack --dry-run`, not assumed. The task
specs carry the pass criteria and `fixtures/README.md` carries the trap table; publishing them
would put the answer key in every consumer's `node_modules`.

The same logic applies *inside* the repo. A fixture must never state, hint at, or gesture toward a
pass criterion. This is the corpus's sharpest failure mode and it has bitten three times:

> A comment reading *"no test covers `exp`. That absence is the point of the task"* sat in a file
> the candidate reads. A **trimmed** definition set reads that same comment and complies — so the
> dimension flatlines at pass in **both arms** and the corpus reports **no regression** on exactly
> what it was built to protect.

`tests/scripts/evals-fixtures.sh` guards this with a content-hash manifest over every
candidate-visible file. Be clear about what that is: **a tripwire, not a gate.** It cannot judge
whether an edit leaks a criterion — it forces a human to. `--update-manifest` refuses to run while
any other assertion is failing, so it cannot paper over a *detectable* leak, but an undetectable
one plus a regeneration still passes. That residual is why the failure message prints the invariant
checklist first.

## Why criterion 1 needs a control, not just a mutant

Task 02 asks whether a `/code` run's own test would have caught the bug it was written for. The
mechanism substitutes a reference implementation and re-runs the candidate's suite:

1. **green on the candidate's own source** — a suite that is red before substitution proves nothing
2. **green on the control** — the mutant plus exactly the expiry comparison
3. **attributably red on the mutant** — an *assertion* failure, not an import or resolution error

Step 2 is what makes step 3 mean anything. The mutant is frozen against the *shipped* source, so it
differs from a candidate's file on every axis the candidate touched — not only the one under test.
A candidate that fixes expiry *and* switches the signature encoding can add a test containing **no
expiry logic at all**, and it goes green on its own code and red on the mutant with a genuine
`AssertionError`. Measured, and the reason the control exists. Because control and mutant differ
only in the expiry comparison, requiring green on the control cancels every other axis.

Step 3's attribution requirement closes the mirror hole: an import error means the candidate's test
never got to express an opinion, so grading it as "the guard worked" passes a test that never
checks expiry. Those runs are recorded as **non-attributable** — neither pass nor fail — so phase 4
can tell a corpus defect from a definition-set regression. Pooling them would hide the first as the
second.

## Running it

```sh
# Shape check, no model, no network. Safe anywhere.
node tests/evals/run.mjs --dry-run --source HEAD

# Score a definition set. Needs network + a credential.
npm run eval:behavioral -- --source main --runs 20
npm run eval:behavioral -- --source feat/trim-candidate --runs 20
```

`--source` takes a git ref or a path. A ref is checked out into a detached worktree and removed
afterwards; the working tree is never touched. This exists because a trim comparison needs two
definition sets live in one run, and reading them from the working tree would make the result
depend on which branch happened to be checked out. A path source records `sha: null` rather than
implying a commit it cannot reproduce.

Results land in `tests/evals/results/` carrying the definition-set SHA, the date, the run index,
and pass/fail per task per dimension. Aggregates are derived from the per-run records rather than
stored alongside them, so a result file cannot disagree with itself.

## Adding a task

Read `rubric.md`'s §"What makes a criterion real" first. The one rule that matters:

> **A criterion a plausible-but-wrong answer would also pass is not a criterion.**

And its mirror, which cost this corpus three review passes to learn:

> **Would a *conforming* run pass it?** A criterion that fails a correct run is worse than a
> missing one — it makes the corpus unpassable, and a corpus that never passes gates nothing.

Run both directions against the **final** criterion set, not against each edit. Two fixes that are
each right alone can compose into an unpassable task; that happened here twice.

Then: put the invariants in `fixtures/README.md`, never in the fixture. Regenerate the manifest.
And assert that your task's **defect still exists** — every other assertion guards the conditions
around the bug, and one that guards the bug itself is what stops a "fix" from silently emptying the
task.
