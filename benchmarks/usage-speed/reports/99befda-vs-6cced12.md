# Usage and speed evidence report: 99befda against 6cced12

The 4.1 release candidate. Pre-registered in [`4.1-release-prereg.md`](./4.1-release-prereg.md) (metrics, scenarios,
caps and budget, committed before any of the candidate's paid rows existed). Procedure:
[`docs/USAGE-BENCHMARK.md`](../../../docs/USAGE-BENCHMARK.md).

**Result: inconclusive on cost, the primary metric, with every figure pointing down. The quality guard is clear.** The
SoMi-over-bare cost overhead ratio is 0.80 (90% interval 0.49 to 0.94); the rule calls "better" only when the whole
interval clears the 20% minimum effect, and its upper end does not. Turns is the one L2 metric called better (0.61,
0.51 to 0.71). The S1 main thread is 96k weighted tokens over 12.5 turns (e376e98: 117k, 16; 6cced12: 164k, 24.5),
so the report-only review escalation the code step now runs did not erase the loop-step gain.

## Required fields

- Report date: 2026-11-02
- Candidate SHA: 99befdad91bbbdd9ba4dc60c351c017ba1a3da7a
- Baseline SHA: 6cced12c90bc14f6af72596f37b9d5f36c2ffb63
- Candidate plugin version: 4.1.0
- Baseline plugin version: 4.1.0
- Rule version: 1
- Rule hash: 2fa87a08e2c9592d9c625ae8c5418a4026b5cb7cf475a4f3a33f5672b662b78e
- Model alias: haiku
- Model tier: low
- Host fingerprint: Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz, 8 cores, 15 GB, 6.8.0-147-generic, node v26.2.0
- Primary metric: cost
- Primary metric chosen on: 2026-11-02, before the candidate was measured
- Guard status: clear. S1 median drop 0, invalid-or-zero rise 0; S2 median drop 0, rise 0; S3 median drop 0, rise 0
- Distribution-only scenarios: S2. Candidate: SoMi 8 draws, green median 1; bare 7, 1. Baseline: SoMi 8, 1; bare 8, 1.

Candidate rows: [`baseline-99befda.json`](../baseline-99befda.json), 48 L2 rows recorded 2026-11-02 as 24
one-repeat chunks at the baseline's caps, one draw at a time, every agent pinned to the low tier, no halt; L0 and
L1 on the same commit from a clean worktree, after the draws. 47 rows are `scored`. One bare S2 draw (seed 1) is
`invalid` (`leak:other-draw`); the guard counts it and it is in no ratio. Spend: $1.95 over 2.11 h. The two-draw
smoke on the same commit (about $0.08) is not in these rows.

## Changes claimed

| Change | Primary metric | Expected direction |
|---|---|---|
| `somi_loop` tool; `/code-loop` and `/plan-loop` flows rewritten on it; `close` writes the progress lines | cost | lower |
| The code step reports a review escalation from the diff (report-only) | cost | higher (added main-thread work) |

## Verdict table

| Layer | Metric | Ratio (candidate / baseline) | 90% interval | Minimum effect | Status |
|---|---|---|---|---|---|
| L0 | bytes | 1.0111 | 1.0111, 1.0111 | 0.01 | worse |
| L1 | ms | 1.0953 | 1.0808, 1.1094 | 0.10 | inconclusive |
| L2 | time | 0.6630 | 0.5489, 0.8843 | 0.30 | inconclusive |
| L2 | cost | 0.7994 | 0.4944, 0.9429 | 0.20 | inconclusive |
| L2 | tokens | 0.7529 | 0.4516, 0.8463 | 0.20 | inconclusive |
| L2 | turns | 0.6089 | 0.5143, 0.7050 | 0.20 | better |

Overall verdict (from the primary metric): inconclusive

The SoMi arm's absolute cost ratio (secondary) is 0.7629 (0.4922, 0.8658). L0 grew 1.1%, past the 1% minimum
effect: the 4.1 flow and tool text is larger than 6cced12's.

### Dollars and time against bare

Medians per draw, 8 draws per arm and scenario (bare S2: 7 scored). "Extra" is SoMi minus bare.

| Scenario | SoMi | Bare | SoMi / bare | Extra | 6cced12 SoMi | 6cced12 SoMi / bare |
|---|---|---|---|---|---|---|
| S1 (`/code-loop`) | $0.031, 113 s | $0.0046, 20 s | 6.8× cost, 5.7× time | $0.027, 93 s | $0.046, 180 s | 9.4×, 8.7× |
| S2 (`/ship-loop`, full) | $0.074, 233 s | $0.0099, 46 s | 7.4×, 5.1× | $0.064, 187 s | $0.070, 247 s | 7.1×, 5.1× |
| S3 (`/ship-loop`, small) | $0.087, 326 s | $0.030, 161 s | 2.9×, 2.0× | $0.057, 165 s | $0.102, 466 s | 3.2×, 3.0× |

All 24 draws per arm: SoMi $1.60 over 1.60 h, bare $0.35 over 0.51 h (6cced12: SoMi $2.11 over 2.10 h, bare $0.38
over 0.54 h).

### Where the turns went (transcripts, not the rule)

Weighted token cost per agent (cache reads 0.1, cache writes 1.25, uncached input 1), medians per SoMi draw, the
same method as the e376e98 report (it reproduces that report's S1 figures exactly). e376e98 → candidate:

| Scenario | Main thread | Coder | Reviewer |
|---|---|---|---|
| S1 (`/code-loop`) | 117k → 96k, 16 → 12.5 turns | 72k → 56k, 10.5 → 9 turns | 57k → 49k, 7.5 → 5.5 turns |
| S3 (`/ship-loop`, small) | 230k → 190k, 24 → 21.5 turns | 155k → 121k, 11 → 8.5 turns | 66k → 64k, 6 → 7 turns (5 draws) |

Read these with the draws behind them; part of the drop is the draws, not the release:

- **S1: one loop pass in every draw that finished.** In e376e98 three of eight draws needed a second pass (23–24
  main-thread turns each). Here seven draws closed after one pass (one with two review steps) and seed 3 stopped
  after its first review to ask the user about a spec conflict, a correct hand-off. Comparing one-pass draws only,
  the main thread still fell from 15–16 turns (107k–118k) to 11–13 turns (87k–102k): no draw edited progress.md
  after `close` (e376e98: 2 to 4 calls in every draw), which matches the 75f886b S1 check (13 turns, 99k).
- **The escalation ran on every S1 code step** and reported `sensitive:auth` (the fixture changes an auth module).
  Its cost is inside the figures above and is not visible as a separate step.
- **S3: three of eight SoMi draws stopped at the code step's scope gate and never reached review** (seeds 2, 6, 7).
  The main thread passed only `bracket.mjs` as the loop's files, the coder also wrote `test/bracket.test.mjs`, and
  the out-of-scope lines, counted double, took the diff past the 400-line cap. Those draws are cheaper because no
  reviewer ran, and they still score full marks because the tests pass. Two further draws (seeds 5, 8) ran the loop
  through the CLI instead of the tool. Without the three stopped draws the S3 drop would be smaller; the rule has no
  way to tell a stopped loop from a finished one when the tests are green.

## Commands run

```text
git archive 99befda (tests and benchmarks excluded) into a scratch plugin directory                exit 0
git worktree add ../bench-candidate 99befda                                                        exit 0
usage-bench.mjs --model haiku --phase experiment --scenarios S1 --repeats 1 --seed <1,2>
  --budget-total 3 --budget-somi 2 --budget-bare 1 --plugin-dir <export of 99befda>              smoke, exit 0
usage-bench.mjs --model haiku --phase experiment --scenarios <S> --repeats 1 --seed <1..8>
  --budget-total 3 --budget-somi 2 --budget-bare 1 --plugin-dir <export of 99befda>              24 chunks, exit 0 each
node tests/scripts/manual/usage-l0.mjs --json                                                      exit 0
node tests/scripts/manual/usage-l1.mjs --json                                                      exit 0
node assemble-baseline.mjs (docs/USAGE-BENCHMARK.md §4.4), like = baseline-6cced12.json            exit 0
node tests/scripts/manual/usage-compare.mjs baseline-99befda.json baseline-6cced12.json --primary cost   exit 0
```

## Limits

- Per release, not per commit: the result covers every change in the release together.
- The verdict is for the recorded model tier only; context-size effects transfer in direction, sizing and
  other behaviour effects do not.
- L0 is exact bytes injected, not tokens billed. L1 is one host fingerprint. Live L2 resolves only large
  changes (about 50% or more); smaller changes read inconclusive by design.
- Quality is a coarse non-inferiority flag only; no quality win or loss is declared. It counts green tests, so a
  loop that stopped before review (three S3 draws) scores the same as one that finished.
- The per-agent split and the turn accounting come from the transcripts, not from the rule; they explain the
  verdict and do not replace it. Pass counts and scope stops are properties of the draws, so the S1 and S3 medians
  depend on how many draws needed a second pass or stopped early.
- The `somi_loop` definition loads with the tool list every session and is in no L0 scenario.
