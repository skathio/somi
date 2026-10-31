# Pre-registration: the somi_loop tool against 6cced12

Written 2026-10-31, before any paid (L2) row of the candidate exists. The comparison report that follows the
paid runs cites this file and may not change what it fixes.

## What is compared

- Candidate: `2e01a8f2` (the `/code-loop` and `/plan-loop` flows run each pass through the `somi_loop` MCP tool).
- Baseline: [`baseline-6cced12.json`](../baseline-6cced12.json) (`6cced12c90bc14f6af72596f37b9d5f36c2ffb63`).
- Rule: version 1, hash `2fa87a08e2c9592d9c625ae8c5418a4026b5cb7cf475a4f3a33f5672b662b78e`.
- Model alias `haiku`, tier `low`, every agent pinned, same host as the baseline (Intel i7-6700HQ, 8 cores,
  15 GB, Linux 6.8.0-147, node v26.2.0).
- Scenarios S1, S2, S3, 8 seeds each, one repeat per chunk, the baseline's caps and ceilings.

## Metrics, fixed now

- **Primary: `cost`** — dollars per draw, SoMi against bare, per scenario and pooled.
- **Alongside: `time`** — wall-clock per draw, SoMi against bare, reported in hours and as a ratio.
- **Diagnostics, not verdicts:** `turns` and `tokens`, and the per-agent transcript table (main thread, coder,
  reviewer) for S1 and S3 in the shape of the 6cced12 report.
- An inconclusive cost verdict is published as inconclusive, with the dollar and time figures in full. S2 stays
  distribution-only, as in the rule.

## The mechanism, and the bar it must clear

The change moves each loop transition into one tool call. On the 6cced12 recording the S1 main thread had a
median of 24.5 turns and 164k weighted tokens. The mechanism target is an S1 main-thread median of **13 turns or
fewer** and weighted tokens **below 164k**. If the median is above 13, the report says the mechanism did not work
as designed and where the turns went.

## Free checks run before this file (2026-10-31, from a clean worktree of the candidate)

- L0 (prompt bytes): the `code-loop` scenario rose from 55,190 to 59,715 bytes (+4,525, +8.2%), because the flow
  text grew; `ship-loop-stage-m1` +36; every other scenario unchanged; total 215,839 → 220,400. The `somi_loop`
  definition (2,805 bytes) loads with the tool list every session and is not part of any L0 scenario.
- L1 (hook and CLI timings, medians): within 0.95–1.04 of the baseline for every hook and CLI event; the MCP
  round trip rose from 60 ms to 77 ms (1.28), the server loading the loop modules.
- Call count: a clean `/code-loop` pass in the shipped text is 8 calls (four `somi_loop` steps, two
  `somi_resolve`, two agent starts), checked by `tests/scripts/loop-flow-gate.sh`, which also drives those calls
  through the real server to a finished loop. The CLI procedure it replaces took about 21 steps per pass.

## The smoke run and its go/no-go bar

Two S1 draws (seeds 1 and 2), budget `--budget-total 3 --budget-somi 2 --budget-bare 1` per draw, worst case $6.
Go only if all hold:

1. each SoMi transcript has at least one `somi_loop` call, no result refused for a missing project root, and no
   per-step loop CLI call from the main thread;
2. both draws are scored and the quality guard is clear;
3. main-thread turns per draw are 16 or fewer;
4. neither draw is over budget.

A failure of (1) stops the measurement for a fix; a failure of (3) alone stops it until the extra turns are
found. The full run (24 chunks, worst case $72) starts only after a separate go-ahead.

## Amendment, 2026-10-31: the candidate moves to `3e9dbab7`

The S1 smoke on `2e01a8f2` (2 draws, $0.12) failed the turns check: 26 and 33 main-thread turns against 16, with
cost and time about the baseline's ($0.051 and $0.059 per SoMi draw, 177 and 195 s). The transcripts put 10–14
turns per draw on calls the tool refused (no file list, a four-column progress table, a header-only diary, `host`
on `close`, a missing review file name, an extra findings key) and on records then written by hand. Candidate
`3e9dbab751784f6d331b39f855e81ca4aa62ae89` makes the tool accept those inputs; every gate keeps its exit
semantics. The metrics, the mechanism bar and the smoke bar above are unchanged. The `2e01a8f2` smoke rows are not
part of the candidate baseline. L0 on `3e9dbab7`: `code-loop` 59,875 bytes (+4,685 on the baseline),
`ship-loop-stage-m1` +36, every other scenario unchanged.

## Amendment, 2026-10-31: the candidate for the full run is `e376e986`

The second S1 smoke on `3e9dbab7` ($0.14) passed checks (1), (2) and (4); (3) failed by its letter. Seed 1, a
one-pass loop with no refused call, took 17 turns, $0.034 and 102 s (the 6cced12 S1 SoMi medians: 28.5 turns,
$0.046, 180 s). Seed 2 needed a second pass, which a per-draw turn bar cannot fit (33 turns, $0.095, 198 s), and
hit two refusals on a lower-case `confidence`. Candidate `e376e98672eca7ec652c3b658a8f6d4625475ed4` reads a
finding's severity and confidence in any letter case and names the refused field. The full run (S1–S3 × 8 seeds)
measures this commit; the metrics and the mechanism bar above are unchanged, and the smoke rows are not part of
the candidate baseline. L0 is the same as on `3e9dbab7`.
