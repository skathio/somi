# Usage and speed evidence report: d5a0bbe against 8c44e2d (worked example, L0 and L1 only)

This is a worked example of the procedure in [`docs/USAGE-BENCHMARK.md`](../../../docs/USAGE-BENCHMARK.md), filled in
from [`TEMPLATE.md`](./TEMPLATE.md). It exercises the free layers end to end against the committed baseline. It makes
no claim about any optimisation: the candidate is the tip of the branch right after the baseline was recorded, so the
expected answer is "no change". The live layer (L2) was not re-run; it is carried as not measured.

## Required fields

- Report date: 2026-10-21
- Candidate SHA: d5a0bbef33f3d09f759026c42d3bd1fcf256783f
- Baseline SHA: 8c44e2d5a98b2f40babe306ce0a19230a2ca1329
- Candidate plugin version: 4.0.0
- Baseline plugin version: 4.0.0
- Rule version: 1
- Rule hash: 2fa87a08e2c9592d9c625ae8c5418a4026b5cb7cf475a4f3a33f5672b662b78e
- Model alias: carried from the baseline file (no model was called in this run); the tool prints it as `<alias>`
- Model tier: low (carried from the baseline file; no model was called in this run)
- Host fingerprint: Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz, 8 cores, 15 GB, os release 6.8.0-146-generic, node v26.2.0, plugin 4.0.0 (identical to the baseline's host block)
- Primary metric: bytes for the L0 comparison, ms for the L1 comparison (two separate runs of the compare tool; this example claims no change, so there is no single headline change)
- Primary metric chosen on: 2026-10-21, before the candidate was measured
- Guard status: not evaluated (the candidate has no L2 rows)
- Distribution-only scenarios: S2 (rule scope). Baseline: 8 SoMi draws with green median 0.774 and 8 bare draws with green median 0.887; candidate: 0 draws.

## Changes claimed

| Change | Primary metric | Expected direction |
|---|---|---|
| None. The only plugin file that differs between the two commits is `hooks/lib/common.mjs` (the audit-directory creation now fails fast instead of hanging on a path that cannot be created). | bytes (L0), ms (L1) | no change |

## Verdict table

| Layer | Metric | Ratio (candidate / baseline) | 90% interval | Minimum effect | Status |
|---|---|---|---|---|---|
| L0 | bytes | 1.0000 | 1.0000, 1.0000 | 0.01 | inconclusive (primary of run 1; no change: every scenario byte count is identical) |
| L1 | ms | 0.9649 | 0.9534, 0.9737 | 0.10 | inconclusive (primary of run 2; about 3.5% faster, inside the 10% minimum effect) |
| L2 | time | not measured | not measured | 0.30 | not comparable (the candidate has no rows) |
| L2 | cost | not measured | not measured | 0.20 | not comparable (the candidate has no rows) |
| L2 | tokens | not measured | not measured | 0.20 | not comparable (the candidate has no rows) |
| L2 | turns | not measured | not measured | 0.20 | not comparable (the candidate has no rows) |

Overall verdict: inconclusive for both primaries, which here means "no change large enough to act on". For L0 that
is exact, not an estimate: all eight scenario byte counts equal the baseline's. For L1 every one of the 14 events has
a candidate median within about 7% of the baseline's (13 of them slightly faster, the audit-log hook 3.5% slower); the
pooled interval sits wholly inside the 10% band, so no speed claim can be made.

## What the example run showed about the tooling

- L0 and L1 produced a valid candidate baseline on the first try; `baselineProblems` passed (schema and the secret and
  path scan).
- With empty candidate L2 rows, the compare tool accepts an L0 or L1 primary: the L2 lines print `not-comparable (a
  scenario has no usable draws in an arm)` and the verdict is computed from the primary only. The quality guard is
  not computed. The `draws` line is not printed. The distribution-only line prints candidate draw counts of 0.
- With an L2 primary (`--primary time`) and empty candidate rows, the tool refuses: `REFUSED: primary metric time: a
  scenario has no usable draws in an arm`, exit 64, then the limits block. So the tool cannot report a "not measured"
  L2 verdict as a verdict; the report states it by hand, as in the table above.
- The `ms` comparison was allowed (not refused) because the host blocks were identical, plugin version included.
- The alias and tier in the candidate file were copied from the baseline so the tool would accept the pair. They are
  not a statement that a model was run; with no L2 rows the alias plays no role in the L0 or L1 numbers.

## Commands run

All from the repository root, in the main checkout (tracked files clean, candidate = HEAD), not a worktree.
`assemble-baseline.mjs` is the scratch helper from section 4.4 of the procedure, kept outside the repository.

```text
node tests/scripts/manual/usage-l0.mjs --json > l0.json                      exit 0
node tests/scripts/manual/usage-l1.mjs --json > l1.json                      exit 0   (30 runs per event, 14 events)
node assemble-baseline.mjs "$PWD" benchmarks/usage-speed/baseline-8c44e2d.json l0.json l1.json candidate.json <alias> low
                                                                             exit 0   (0 L2 rows, 14 L1 events)
node tests/scripts/manual/usage-compare.mjs candidate.json benchmarks/usage-speed/baseline-8c44e2d.json --primary bytes   exit 0
node tests/scripts/manual/usage-compare.mjs candidate.json benchmarks/usage-speed/baseline-8c44e2d.json --primary ms      exit 0
node tests/scripts/manual/usage-compare.mjs candidate.json benchmarks/usage-speed/baseline-8c44e2d.json --primary time    exit 64 (refused)
```

Compare output for `--primary ms`, excerpt (the tool also prints the distribution-only line and its own limits block):

```text
rule hash: 2fa87a08e2c9592d9c625ae8c5418a4026b5cb7cf475a4f3a33f5672b662b78e (version 1, sealed)
candidate d5a0bbef33f3d09f759026c42d3bd1fcf256783f  baseline 8c44e2d5a98b2f40babe306ce0a19230a2ca1329  tier low  alias <alias>
primary metric: ms
metric   layer role       basis     ratio    lower    upper    min    status
bytes    L0    reported   absolute  1.0000   1.0000   1.0000   0.0100  inconclusive
ms       L1    primary    absolute  0.9649   0.9534   0.9737   0.1000  inconclusive
time     L2    reported   overhead  -   -   -   0.3000  not-comparable (a scenario has no usable draws in an arm)
cost     L2    reported   overhead  -   -   -   0.2000  not-comparable (a scenario has no usable draws in an arm)
tokens   L2    reported   absolute  -   -   -   0.2000  not-comparable (a scenario has no usable draws in an arm)
turns    L2    reported   absolute  -   -   -   0.2000  not-comparable (a scenario has no usable draws in an arm)
VERDICT: inconclusive
```

## Limits

- Per release, not per commit: a result covers every change in the release together. This one covers no claimed change.
- The verdict is for the recorded model tier only; no model was called here.
- L0 is exact bytes injected, not tokens billed. L1 is one host fingerprint (the machine that recorded the baseline).
  Live L2 resolves only large changes (about 50% or more); smaller changes read inconclusive by design.
- L2 was not re-run for this example, so cost, time, turns, tokens, the quality guard and the S2 distribution are
  carried as not measured. Nothing in this report is evidence about them.
- Quality is a coarse non-inferiority flag only; no quality win or loss is declared.
- L1 is one run of 30 repeats per event; machine load during the run was not controlled or recorded.
