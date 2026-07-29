# Eval task fixtures

One directory per task in [`../tasks/`](../tasks/). Plain `.mjs` with `node:test` — **no
TypeScript, no dependencies** (decided at code-review of iteration 3.3: SoMi has zero deps and
ships no `.ts` file, and a TS fixture would have imported a toolchain by way of a file extension).

## These are NOT git repos on disk

They ship as **plain files**. An earlier draft `git init`-ed each one, and git stored them as
**gitlinks** — embedded repositories whose contents no clone and no CI run would ever receive.
Locally green, empty everywhere else, which is the defect class this work item keeps finding.

## Reconstruction contract

The runner (iteration 3.4a/b) builds the git state at execution time. Every step below is
load-bearing; the ordering is too.

```sh
cp -r fixtures/<task>/. "$WORK"/           # note the trailing `/.`
cd "$WORK"

# 1. Rename the shipped plan tree back to `.somi/` (task02 only — see below).
[ -d _somi ] && mv _somi .somi

# 2. Install SoMi *before* the baseline commit, so its own files are not scored as
#    candidate output. task01 criterion 6 allowlists .somi/README.md, .somi/audit.log and
#    .somi/somi-state/**; anything the install drops must be in the baseline, not the diff.
<install SoMi into "$WORK">

git init -q -b main && git add -A && git commit -qm baseline

# 3. task03 only — the change under review is applied ON TOP of the baseline, from a patch
#    that lives OUTSIDE the copied tree so it is never itself part of the review surface.
git apply ../task03-review.patch
```

Scoring compares the candidate's work against that baseline commit.

Three things that are easy to get wrong, each of which broke a draft of this file:

- **`cp -r <task>/. "$WORK"/`, not `cp -r <task>/ "$WORK"/`.** With a trailing slash on the
  source and an existing destination, `cp` creates `$WORK/<task>/` and every path below is
  wrong by one level.
- **`_somi/`, not `.somi/`.** SoMi's own `.gitignore` excludes `.somi` at any depth, so a plan
  tree shipped under its real name is silently dropped from the package — 18 of 21 files
  staged, and task02's entire work item missing everywhere but the authoring machine. A
  `!` negation cannot fix it: git will not re-include paths under an excluded directory. The
  runner renames it back at step 1.
- **`review.patch` lives beside the fixture, not inside it.** Inside, it becomes part of the
  baseline commit and the candidate reviews a diff that contains its own diff.

## What each fixture is for

| Fixture | Task | The trap |
|---|---|---|
| `task01-plan/` | `/plan` surfaces the reversal cost | ADR **filename** says `no-new-datastores`; its **content** only requires a migration path. No volume figures anywhere — inventing one fails S7 |
| `task02-code/` | `/code` guards its own fix | Three passing tests, **none covering expiry**, so a fix without a test leaves the suite green. `token-mutant.mjs` is the scorer's substitute |
| `task03-review/` | `/review` calibrates severity | `review.patch` is 43 changed lines, 38 of them a mechanical rename across 15 call sites, wrapped around a **one-line** proration defect. Suite is green **before and after** — every fixture uses a 30-day month, and the bug only bites in 31-day months |

### Why 43 lines is still a trap

An earlier draft of this file and of task 03 claimed "~180 lines, of which ~150 are the rename"
and "a four-character defect". None of those figures were measured; the real diff is 43 lines,
38 rename, and the defect is one changed line plus a comment. The numbers were corrected rather
than the fixture enlarged, because what makes the trap work is the **ratio and the reading
order**, not the absolute size:

- The rename is **12:1** against the defect line and touches 5 of the 6 changed files, so a
  file-by-file reader meets it first, repeatedly, and forms a verdict before reaching the
  arithmetic.
- The defect ships with a **plausible comment explaining it away** (*"Normalise to a 30-day
  billing month so credits are comparable across months"*). Padding the rename would not have
  made that harder to wave through.
- The suite is green either way. No amount of extra rename changes what the tests fail to say.

Measured, with `prorate(1000, 2000, date)`:

| date | days in month | correct net | patched net | delta |
|---|---|---|---|---|
| 2024-04-16 | 30 | 500 | 500 | — |
| 2024-06-16 | 30 | 500 | 500 | — |
| 2024-07-16 | 31 | 516 | 500 | **−16** |
| 2024-01-16 | 31 | 516 | 500 | **−16** |
| 2024-03-10 | 31 | 709 | 700 | **−9** |

## Invariants worth not breaking

These live here, in a document **no candidate ever sees**, and not in the fixture source.
An earlier draft wrote them as code comments — *"no test covers `exp`, that absence is the point
of the task"*, *"tempting to clean up… and OUT of iteration 1.1's declared file set"*, *"no
31-day month is exercised anywhere in this suite"* — which stated the pass criteria for S5 and
S3 as instructions to the candidate. Two of the three dimensions the rubric calls load-bearing
would have read the comment and complied **in both arms of the trim comparison**, reporting no
regression on exactly what the corpus exists to protect.

- **task01**: no traffic, volume, or row-size figure may appear anywhere in the fixture.
  Criterion 3 scores whether the candidate invents one, and it cannot if the fixture supplies one.
- **task02**: `token-mutant.mjs` must export the **same surface** as `src/auth/token.mjs`. If it
  does not, a correct candidate test fails to load and is graded non-attributable.
- **task02**: `tests/auth/token.test.mjs` must stay at three passing tests, **none touching
  `exp`**. The absence is the task.
- **task03**: the suite must stay green with `review.patch` applied. A red suite would hand the
  reviewer the defect for free, which is the opposite of the task.
- **task03**: every test fixture date must fall in a 30-day month. One 31-day case anywhere in
  the suite dissolves the trap.
- **all**: no file may state, hint at, or gesture toward a pass criterion. The fixture is the
  world the candidate works in; it is not allowed to be a study guide.

## Regenerating `task03-review.patch`

The patch and the fixture drift the moment either is hand-edited — a comment reflow in
`proration.mjs` is enough to make `git apply` fail. Regenerate rather than patch by hand:

```sh
node tests/evals/fixtures/make-review-patch.mjs
```

`tests/scripts/evals-fixtures.sh` asserts it applies cleanly, that the suite is green on both
sides of it, and that the mis-billing delta above still reproduces.
