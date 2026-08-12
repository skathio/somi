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
defect's **semantic invisibility**, not its size or its position:

- The defect ships with a **plausible rationale** (*"Normalise to a 30-day billing month so
  credits are comparable across months"*) — coherent, and the kind of thing real billing systems
  actually do.
- `Math.min(daysInMonth(d), 30)` is **arithmetically well-formed**. Nothing looks like a bug.
- The suite is **green either way**, and constructing the failing case requires the reviewer to
  invent an input class — a 31-day month — that appears nowhere in the fixture.
- The rename supplies **38:1 of surrounding noise** against the one-line defect (12.7:1 against
  the three-line hunk), across 5 of the 6 changed files.

Padding the rename would not strengthen any of the first three, which is why the fixture was not
resized.

> **An earlier version of this section argued from reading order** — that "a file-by-file reader
> meets the rename first, repeatedly, and forms a verdict before reaching the arithmetic." That is
> **false for the shipped patch**, and was written before anyone looked. `git diff` sorts by path,
> so `src/billing/proration.mjs` is file **2 of 6** and the defect sits at changed lines **5–7 of
> 43** — *ahead of* 36 of the 38 rename lines. The conclusion (don't resize) survives; the
> argument under it did not, and it was the half being used to support the conclusion. If reading
> order should genuinely contribute, move the defect to a late-sorting path such as
> `src/pricing/proration.mjs`; that is a deliberate change, not a repair.

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

## R5 conformance audit (phase 1, iteration 1.1)

`spec.md`'s R5 — "fixtures carry a real suite and a real defect, so pass conditions are
mechanical" — checked against the fixture files themselves, not restated from the plan that
proposed the answer:

- **`task01-plan/`** — **R5 not applicable in its suite-and-defect form**: `/plan` produces a
  design decision, not code to test. Checkable directly, not hand-counted: no file under
  `task01-plan/` is named `package.json`, and none matches a test-file pattern (`*.test.*`,
  `*.spec.*`, or a `tests/` directory) — there is nothing for a "real suite" requirement to attach
  to. The tree is `CLAUDE.md`, one ADR, and four files under `src/` (`auth/api-key.mjs`,
  `db/client.mjs`, `db/schema.sql`, `ingest/handler.mjs`) — three `.mjs` sources and one `.sql`
  schema, six files total. Inherent to the task shape, not a gap. R5's *purpose* — mechanical pass
  conditions — is still met for task01 by a different mechanism: `decisions.md#d11` settles
  task01's S3 (the file-boundary check) as one of the corpus's three gating dimensions.
- **`task02-code/`** — **meets R5**: `tests/auth/token.test.mjs` is exactly three named tests —
  `accepts a validly-signed token`, `rejects a tampered signature`, `rejects malformed input` —
  and reading all three directly confirms none asserts anything about expiry. (`evals-fixtures.sh`'s
  `grep -ncE '\bexp\b|expir'` assertion also returns 0, but that is a regression tripwire on a
  known phrasing, not proof of absence: a test such as `assert.throws(() =>
  verifyToken(mintToken('u', 1)))` would cover expiry while tripping neither pattern. The
  enumeration above is the sound evidence; the grep is corroborating, not load-bearing.) The
  defect is real: the shipped `src/auth/token.mjs`'s `verifyToken()` has no expiry branch at all —
  it parses and returns the payload unconditionally — the same absence the mutant
  (`task02-code-mutant.mjs`) deliberately preserves. (The mutant is not a byte-for-byte freeze of
  the shipped file: it takes a second parameter, `verifyToken(token, nowMs = Date.now())`, so that
  mutant and control present an identical seam; R4 fixes that parameter's *shape* if a clock is
  injected at all, and explicitly permits reading `Date.now()` directly instead
  (`task02-code/_somi/plans/expired-token/spec.md:13-15`) — it does not require accepting one.
  `evals-fixtures.sh`'s "mutant and control export the same surface as token.mjs" assertion checks
  export-key parity between the two, not arity, so nothing enforces the stronger "freeze" reading.)
  `evals-fixtures.sh`'s "shipped token.mjs accepts an expired token" assertion exercises the claim
  directly against the shipped file, not the mutant.
- **`task03-review/`** — **meets R5**: the suite is green both before and after `review.patch`
  applies (`evals-fixtures.sh`'s two `3/0` assertions), and the defect is a genuine one-line
  semantic change in the patch (`daysInMonth(changeDate)` → `Math.min(daysInMonth(changeDate),
  30)`), invisible against every 30-day-month date the suite exercises (April 16, June 1,
  September 30) and already measured against real 31-day inputs in "Why 43 lines is still a trap"
  above.

**One genuine gap surfaced, on re-examination of this section's own first draft.**
`evals-fixtures.sh` closes leak classes 1 and 2 in full — a comment hinting at a pass criterion
(the keyword denylist, `:158-165`, plus the manifest tripwire, `:126-141`), and a stale manifest
masking a real change (the manifest-currency count check, `:142-151`). Class 3 — a
fixture-readable file stating an invariant it shouldn't see — is closed **at the file-placement
level** by two real assertions written for exactly this bite: no reference implementation lives
inside `task02-code/` (`:167-172`), and `review.patch` is NOT inside `task03-review/` (`:178-180`).
But this document's own "Invariants worth not breaking" section reaching `$WORK` was, until this
pass, guarded by nothing but a filesystem-layout fact, not an assertion: it lives one level above
the copied tree, and the live reconstruction (`tests/evals/run.mjs`, `mkdtempSync` +
`cpSync(fixtureDir, work)` around line 406) only ever copies the resolved per-task directory.
`evals-fixtures.sh` did not read `run.mjs` at all before this pass — that property was true but
unasserted. A future change to the copy step (the same shape as the `$WORK`-must-be-outside-the-
checkout leak this document already names above, "the bug and the leak were the same character")
would pass every assertion that existed before this pass, none of which inspects `run.mjs`, while
shipping this section's own trap table and invariant list to a candidate.

**Narrowed this pass** (revised from an earlier draft of this note that claimed "closed" —
correcting the same mistake it was written to fix): the original fix was two presence greps over
`run.mjs`'s source, which cannot establish the universal that earlier draft claimed ("never a
broader one") — they show two facts are present, not that a third, unrelated one is absent. Staged
proof, against that two-grep-only version: an *added* line right after the existing copy call,
`cpSync(join(fixtureDir, '..'), join(work, 'shared'), …)`, left both greps' anchors untouched and
the gate stayed **47/0 green**. That variant is the silent one — the per-task copy still lands
correctly, the run behaves normally, and the candidate additionally gets the fixtures root,
including this section's own trap table, at a path (`$WORK/shared/`) the leak keyword denylist
above never scans. `run.mjs` has exactly four `cpSync(` occurrences; pinning that count — via
`grep -o 'cpSync(' | wc -l`, not `grep -c`, which counts matching *lines* and would miss a second
occurrence appended to the already-matching copy line — is **bidirectional** (D11's first test: it
independently fails on both an added and a removed occurrence), which the two presence greps above
are not. It is **not** a closed enumeration under D11's soundness test: `decisions.md#d11` requires
complete enumeration over a closed input, and a literal-substring grep over an arbitrary,
freely-editable source file is exactly the pattern-search case that rule excludes — a call reached
via `copyFileSync`, `execFileSync('cp', …)`, or an alias would not move this count. Same register as
the `\bexp\b|expir` grep above (`:206-209`): a regression tripwire on a known substring, not proof
of absence. So this dimension does not become D11-gating-grade; the pin narrows the seam rather
than closing it — a real, sufficient improvement over the presence greps by bidirectionality alone.
Staged proof against the 48-assertion suite: an added occurrence on a *new* line gives
**47 passed, 1 failed**; the identical addition appended to the *end of* the existing copy line —
the variant a line-counting `grep -c` would have missed, and did miss in an earlier draft of this
pin — also gives **47 passed, 1 failed**; reverting either gives **48/0** again. **Named rather than
left silent**: the count pin does not cover a change to what
the `fixtureDir` *argument* resolves to before it reaches the copy (the CLI driver's single
`fixtureFor(id, source.dir)` call, `run.mjs` ~line 820) — the count stays four either way,
verified by staging both `dirname(fixtureFor(id, source.dir))` and a resolver bypass
(`join(source.dir, 'tests', 'evals', 'fixtures')`) against the 48-assertion suite and observing
**48/0 green** on each. Both variants still copy the fixtures root into `$WORK` — the leak occurs
either way, since neither touches the copy call itself, only what `fixtureDir` resolves to before
it. What is inferred, not confirmed, is that the accompanying tree-shape mismatch (every task file
one level deep, `_somi` never renamed) breaks the run visibly enough downstream that a corrupted
measurement would be noticed rather than scored; confirming that needs a live model invocation, out
of reach for this audit — so this residual is accepted here rather than closed with a second
assertion. See
`tests/scripts/evals-fixtures.sh` for the check itself and its comment for the full reasoning.
This qualified as the conditional step's trigger (a genuine gap resembling a leak class already
fixed in this corpus's history — the same class, reopened one layer down at the reconstruction
path rather than the shipped tree), not a new leak class, so it is recorded here rather than as a
fourth bullet above.
