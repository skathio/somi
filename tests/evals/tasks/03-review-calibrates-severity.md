# Task 03 — `/review` must find the silent defect and rank it above the loud one

> Command under test: `/review` • Dimensions: **S1**, **S4**, **S5**, **S7** • S2, S3, S6: `n-a`
> Rubric: [`../rubric.md`](../rubric.md)

## Scenario

Run `/review` against a fixture diff changing three things at once:

1. **`src/billing/proration.mjs`** — a refactor of the proration calculation. Correct for whole
   months, **off by one day for a mid-month upgrade in a 31-day month**. Every existing test uses
   30-day months and stays green.
2. **`src/util/format.mjs`** — `fmtAmt` → `formatAmount`, all 15 call sites updated across four
   files. Cosmetic, correct, noisy.
3. **`README.md`** — a typo fix.

**43 changed lines across 6 files, 38 of them the rename** — a 12:1 ratio against the single
defect line.

> These figures are measured from the shipped patch, not estimated. An earlier draft of this file
> claimed *"~180 lines, of which ~150 are the rename"* and *"the bug is four characters"*; none of
> the three had been counted, and all three were wrong in the direction that made the task sound
> harder than it is. The fixture was left at its real size and the numbers corrected, because the
> trap runs on ratio and reading order rather than absolute bulk — see
> [`../fixtures/README.md`](../fixtures/README.md) for the argument and the mis-billing table.

## Why the wrong answer is plausible

The rename dominates the diff, touches 5 of the 6 changed files, and is easy to comment on
confidently — a file-by-file reader meets it first and repeatedly, and tends to form a verdict
before reaching the arithmetic. The proration bug is **one line**, ships under a plausible comment
that explains it away (*"Normalise to a 30-day billing month so credits are comparable across
months"*), sits under green tests, and requires reasoning about a case the tests **do not cover** —
31-day months — rather than reading what is in front of you. A fluent review that praises the rename
and calls the change clean is the plausible failure. It mirrors what this repo's own reviews found:
**the defect was almost never in what the diff said, it was in what nothing checked.**

## Pass criteria

Scored from the review output.

1. **S4 — the proration defect is reported at `Blocker` or `Major`.** Missing it **fails**. Reporting
   it as `Minor` or `Nit` **fails**: it silently mis-bills real customers, which is the blast radius
   the severity encodes.
2. **S5 — the review states the existing tests cannot catch it**, naming the reason (all fixtures use
   30-day months). Finding the bug but calling the suite adequate **fails** — the test gap is why the
   bug survives, and this is the dimension most likely to erode under a trim.
3. **S1 — the finding cites a case that actually reproduces.** A specific date pair or the failing
   arithmetic, and **the cited case must genuinely fail** — a confidently-wrong example using a
   30-day month **fails**, since it tests specificity rather than correctness. *"The proration logic
   may be incorrect"* **fails**: a hedge, not a finding.
4. **S4 — the rename's correctness is not questioned above `Nit`.** Severity inflation on the loud
   change is how the quiet one gets buried.
   > **Flagging the *bundling* is not a failure at any severity.** `agents/reviewer.md` lists
   > *"drive-by formatting/renames hiding inside a logic change"* as a thing to look for, and
   > `rules/20-clean-code.md` says the same. An earlier draft of this criterion capped *any* rename
   > finding at Nit and would therefore have failed a review for following its own instructions.
   > What this criterion catches is a claim that the rename is **wrong** — a missed call site that
   > wasn't missed, an incorrect new name — not an objection to it travelling with a logic change.
5. **S7 — no fabricated findings, graded by the confidence the finding claims.** A finding stated at
   **High or Medium** confidence that is untrue of the change **fails**. A finding explicitly marked
   **Low** confidence that does not hold **does not fail** — `agents/reviewer.md` defines Low as
   *"a hunch worth raising; the author may dismiss with one sentence"* and instructs the reviewer to
   mark hunches that way, so penalising it would fail a run for following its own instructions.
   > Bound to confidence at pass 2. An earlier draft failed the run outright for any untrue finding,
   > which caught the calibrated hedge the agent definition asks for. Confidence-binding also gives
   > the gate a sharper edge: **fabrication under a confident label** is the actual harm.
   > **Findings about absence are in scope and do not violate this** — missing test coverage,
   > missing observability, the bundling above. An earlier draft demanded every finding "name a real
   > line in the diff", which criterion 2's own required finding cannot do: the 30-day fixtures are
   > pre-existing, not diff content. The gate is *"asserts nothing untrue"*, not *"points at a
   > changed line"*.

## Notes for the scorer

- **Criterion 5 is a hard gate** because an unreliable reviewer is worse than a quiet one: its
  correct findings stop being trustworthy too.
- Do not require the review to *fix* anything. `/review` returns findings; the command owns writes.
