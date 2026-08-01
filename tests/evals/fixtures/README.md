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
# Absolute, and derived once: the patch is resolved against THIS directory, never against $WORK.
FIXTURES="$(cd "$(dirname "$0")/fixtures" && pwd)"

cp -r "$FIXTURES/<task>/." "$WORK"/        # note the trailing `/.`
cd "$WORK"

# 1. Rename the shipped plan tree back to `.somi/` (task02 only — see below).
[ -d _somi ] && mv _somi .somi

# 2. Install SoMi *before* the baseline commit, so whatever the INSTALL drops is baseline
#    rather than candidate output. This affects `.somi/README.md` and anything under
#    `.claude/` — and nothing else. It does NOT put `.somi/audit.log` or
#    `.somi/somi-state/**` in the baseline: those are written by the PostToolUse and
#    UserPromptSubmit hooks on every turn *during* the run, so no ordering can pre-commit
#    them. That is precisely why task01 criterion 6 allowlists them by category instead.
<install SoMi into "$WORK">   # 3.4b decides the mechanism; see the note below

git init -q -b main && git add -A && git commit -qm baseline

# 3. task03 only — the change under review is applied ON TOP of the baseline, from a patch
#    that lives OUTSIDE the copied tree so it is never itself part of the review surface.
#    Resolve it absolutely: `$WORK` is a scratch directory, so a relative `../` points at
#    that directory's parent, NOT at fixtures/.
git apply "$FIXTURES/task03-review.patch"
```

Scoring compares the candidate's work against that baseline commit.

**`$WORK` must be outside the SoMi checkout.** An earlier draft wrote step 3 as
`git apply ../task03-review.patch`, which does not resolve for any scratch `$WORK` — and the
only layout under which it *would* resolve puts `$WORK` inside `fixtures/`, one `..` from this
file. A candidate could then read the trap table, the invariant list, and the graded criteria
in `../../tasks/`. The bug and the leak were the same character.

**`<install SoMi into "$WORK">` is a placeholder, and 3.4b owns it.** What is settled here: it
runs before the baseline commit, and it must not introduce a `.gitignore` (below). What is not:
the mechanism. Do not read the ordering as making the whole criterion-6 allowlist unnecessary —
two of its three paths are run-time hook output and always appear as candidate diff.

Things that are easy to get wrong, each of which broke a draft of this file:

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
- **So do the task02 reference implementations.** `task02-code-mutant.mjs` and
  `task02-code-control.mjs` sit beside `task02-code/`, never in it. Shipped inside, the mutant
  landed in the candidate's baseline commit, where its header announced that a copy of
  `token.mjs` without expiry enforcement existed and a NOTE named the defect outright — strictly
  more informative than the three comments pass 1 removed as a Blocker. Same fix as
  `review.patch`, applied one step further.

**Nothing in this contract may introduce a `.gitignore` containing `.somi` into `$WORK`.** The
rename at step 1 restores the plan tree's real name, so a `.gitignore` written by the install
step — or by a future runner being helpful — makes `git add -A` skip it again and the candidate
meets a work item with no phase file. That is B1 reappearing one layer down, where none of the
ship-time checks can see it: they inspect the fixture, and this happens after the copy. No SoMi
command writes a `.gitignore` today; `tests/scripts/evals-fixtures.sh` reconstructs task 02 and
asserts all four plan files are tracked in the baseline commit, so it stays that way.

## What each fixture is for

| Fixture | Task | The trap |
|---|---|---|
| `task01-plan/` | `/plan` surfaces the reversal cost | ADR **filename** says `no-new-datastores`; its **content** only requires a migration path. No volume figures anywhere — inventing one fails S7 |
| `task02-code/` | `/code` guards its own fix | Three passing tests, **none covering expiry**, so a fix without a test leaves the suite green. the scorer substitutes a reference implementation kept outside the tree |
| `task03-review/` | `/review` calibrates severity | `review.patch` is 43 changed lines, 38 of them a mechanical rename across 15 call sites, wrapped around a **one-line** proration defect. Suite is green **before and after** — every fixture uses a 30-day month, and the bug only bites in 31-day months |

### Why 43 lines is still a trap

An earlier draft of this file and of task 03 claimed "~180 lines, of which ~150 are the rename"
and "a four-character defect". None of those figures were measured; the real diff is 43 lines,
38 rename, and the defect is one changed line plus a comment. The numbers were corrected rather
than the fixture enlarged, because what makes the trap work is the **ratio and the reading
order**, not the absolute size:

- The rename is **38:1** against the one-line defect (12.7:1 against the three-line hunk) and touches 5 of the 6 changed files, so a
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
- **task02**: `task02-code-mutant.mjs` and `task02-code-control.mjs` must export the **same
  surface** as `src/auth/token.mjs`, and must differ from each other **only** in expiry
  enforcement. If the surfaces diverge, a correct candidate test fails to load and is graded
  non-attributable.
- **task02**: neither reference file may live inside `task02-code/`. The reconstruction copies
  that directory wholesale into the candidate's repo.
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

`tests/scripts/evals-fixtures.sh` runs `make-review-patch.mjs --check` (byte-compare against the
committed patch, the same shape as `generate-digest.mjs --check`), and additionally asserts it
applies cleanly, that the suite is green on both sides of it, and that the mis-billing delta
above still reproduces. Without `--check` the committed patch and its generator can disagree
indefinitely: a hand-edit that still applies passes every other assertion.

## Why criterion 1(b) needs a control, not just a mutant

The mutant is frozen against the **shipped** `token.mjs`, so it differs from a *candidate's*
`token.mjs` on every axis the candidate touched — not only expiry. A candidate that fixes expiry
and also switches the signature encoding can write a test containing no expiry logic at all (one
that merely pins the new encoding), and it goes green on its own code and red on the mutant with
a genuine assertion failure. That satisfies 1(b) as written while answering none of the question
it asks. Verified: `pass 3, fail 1`, `AssertionError`.

`task02-code-control.mjs` is the mutant plus the expiry comparison. Requiring **green on the
control and red on the mutant** cancels every non-expiry difference, because the two files differ
only there. The same cheating test is red on the control, so the run is rejected before the
mutant is consulted.
